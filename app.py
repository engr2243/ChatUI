from flask import Flask, render_template, request, jsonify
import requests as req
import json, os
from datetime import datetime, timezone

app = Flask(__name__)

_CONFIG_FILE = os.path.join(os.path.dirname(__file__), "config.json")


def _load_settings():
    try:
        with open(_CONFIG_FILE, "r") as f:
            return json.load(f)
    except (FileNotFoundError, json.JSONDecodeError):
        return {"endpoint": "", "email_address": "", "user_name": "", "agent_url": ""}


def _save_settings(data):
    with open(_CONFIG_FILE, "w") as f:
        json.dump(data, f, indent=2)


_settings = _load_settings()


def _file_extension(filename, mime_type=""):
    """Derive a clean file extension from filename or MIME type."""
    if filename and "." in filename:
        return filename.rsplit(".", 1)[-1].lower()
    mime_map = {
        "application/pdf":   "pdf",
        "image/png":         "png",
        "image/jpeg":        "jpeg",
        "image/jpg":         "jpeg",
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document": "docx",
        "application/msword": "doc",
    }
    return mime_map.get(mime_type, "bin")


def _build_n8n_payload(payload):
    """
    Transform ChatUI payload → n8n email-shaped trigger payload.

    ChatUI sends:
        session_id, chat_input, attachment (base64), attachment_name,
        attachment_type, subject, email_address, user_name

    n8n trigger expects:
        threadId, id, messageId, references,
        subject, date, Label, routing, isForwarded,
        from.value[], to.value[], cc.value[],
        text, html,
        binary: {
            "<filename>": {
                data, mimeType, fileName, fileExtension, fileType, fileSize
            }
        }

    The attachment processor (Code3 node) iterates Object.entries(binary)
    and reads fileData.data (base64), fileData.fileExtension, fileData.fileType,
    fileData.fileName.  OCR-PDF passes fileData.data directly to Mistral OCR
    as "data:application/pdf;base64,<data>".
    """
    session_id      = payload.get("session_id", "")
    chat_input      = payload.get("chat_input", "")
    subject         = payload.get("subject") or "Chat Message"
    user_name       = payload.get("user_name") or _settings.get("user_name", "")
    email_address   = payload.get("email_address") or _settings.get("email_address", "")
    attachment_b64  = payload.get("attachment")
    attachment_name = payload.get("attachment_name") or "attachment"
    attachment_type = payload.get("attachment_type") or "application/octet-stream"

    ext       = _file_extension(attachment_name, attachment_type)
    file_type = ext  # e.g. "pdf", "png", "docx"

    n8n = {
        # ── Session / thread identity ──────────────────────────────────
        "threadId":  session_id,
        "id":        session_id,
        "messageId": f"chat-{session_id}",
        "references": None,

        # ── Email metadata ─────────────────────────────────────────────
        "subject": subject,
        "date":    datetime.now(timezone.utc).isoformat(),
        "Label":   "CHAT",

        # ── Routing flags ──────────────────────────────────────────────
        # "bot_only"  → Route2 takes the short path (no email sending)
        # isForwarded → If1 / Route gate
        "routing":     "bot_only",
        "isForwarded": False,

        # ── Agent target ───────────────────────────────────────────────
        "agent_url": _settings.get("agent_url", ""),

        # ── Participants ───────────────────────────────────────────────
        "from": {
            "value": [{"name": user_name, "address": email_address}]
        },
        "to": {
            "value": [{"name": "Patchbay AI", "address": "asst@patchbay.xyz"}]
        },
        "cc":  {"value": []},

        # ── Message body ───────────────────────────────────────────────
        "text": chat_input,
        "html": None,

        # ── Binary attachments (empty by default) ─────────────────────
        # Keyed by filename so Code3 can iterate Object.entries(binary).
        # Each value matches n8n's binary descriptor shape:
        #   data          → raw base64 (no data-URI prefix)
        #   mimeType      → MIME type string
        #   fileName      → original file name
        #   fileExtension → "pdf" | "png" | "docx" | "doc" etc.
        #   fileType      → same as fileExtension (used by Switch2 routing)
        #   fileSize      → byte length of decoded content (approx from b64 length)
        "binary": {},
    }

    if attachment_b64:
        # Approximate decoded byte size: base64 len * 3/4
        approx_size = int(len(attachment_b64) * 3 / 4)

        n8n["binary"][attachment_name] = {
            "data":          attachment_b64,       # raw base64, no prefix
            "mimeType":      attachment_type,
            "fileName":      attachment_name,
            "fileExtension": ext,
            "fileType":      file_type,            # Switch2 checks this
            "fileSize":      approx_size,
        }

    return n8n


@app.route("/")
def index():
    return render_template("index.html")


@app.route("/api/settings", methods=["GET", "POST"])
def settings():
    if request.method == "POST":
        data = request.get_json(force=True)
        _settings["endpoint"]      = data.get("endpoint", "").strip()
        _settings["email_address"] = data.get("email_address", "").strip()
        _settings["user_name"]     = data.get("user_name", "").strip()
        _settings["agent_url"]     = data.get("agent_url", "").strip()
        _save_settings(_settings)
        return jsonify({"ok": True})
    return jsonify(_settings)


@app.route("/api/chat", methods=["POST"])
def chat():
    if not _settings["endpoint"]:
        return jsonify({"error": "API endpoint not configured. Open Settings to set it."}), 400

    raw     = request.get_json(force=True)
    payload = _build_n8n_payload(raw)

    try:
        resp = req.post(_settings["endpoint"], json=payload, timeout=1200)
        resp.raise_for_status()
        body = resp.text.strip()
        if not body:
            return jsonify({"error": "API returned an empty response."}), 502
        return jsonify(resp.json())
    except req.exceptions.Timeout:
        return jsonify({"error": "Request to API timed out (1200 s)."}), 504
    except req.exceptions.ConnectionError:
        return jsonify({"error": f"Could not connect to: {_settings['endpoint']}"}), 502
    except req.exceptions.HTTPError:
        return jsonify({"error": f"API returned {resp.status_code}: {resp.text[:200]}"}), 502
    except Exception as e:
        return jsonify({"error": str(e)}), 500


if __name__ == "__main__":
    print("ChatUI running at http://localhost:5000")
    app.run(debug=True, port=5000)
