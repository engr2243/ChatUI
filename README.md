# Patchbay ChatUI

A lightweight Flask-based chat interface that forwards messages (and file attachments) to an n8n webhook, shaped as email-style payloads for the Patchbay AI agent pipeline.

---

## Prerequisites

- Python 3.10+
- pip
- (Optional) Docker, for containerised setup

---

## Local Setup

### 1. Clone the repo

```bash
git clone https://github.com/engr2243/ChatUI.git
cd ChatUI
```

### 2. Create and activate a virtual environment

**macOS / Linux**
```bash
python3 -m venv venv
source venv/bin/activate
```

**Windows**
```powershell
python -m venv venv
venv\Scripts\Activate.ps1
```

### 3. Install dependencies

```bash
pip install -r requirements.txt
```

### 4. Configure the app

Edit `config.json` with your settings:

```json
{
  "endpoint": "https://your-n8n-instance/webhook/chat",
  "email_address": "you@example.com",
  "user_name": "Your Name",
  "agent_url": ""
}
```

| Field | Description |
|---|---|
| `endpoint` | The n8n webhook URL that receives chat messages |
| `email_address` | Sender identity used in the forwarded payload |
| `user_name` | Display name used in the forwarded payload |
| `agent_url` | (Optional) Target agent URL passed through to n8n |

You can also update these live via the **Settings** panel in the UI without restarting the server.

### 5. Run the development server

```bash
python app.py
```

Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## Docker Setup

### Build the image

```bash
docker build -t patchbay-chatui .
```

### Run the container

```bash
docker run -p 5000:5000 -v $(pwd)/config.json:/app/config.json patchbay-chatui
```

> On Windows PowerShell, replace `$(pwd)` with `${PWD}`.

Open [http://localhost:5000](http://localhost:5000) in your browser.

---

## How It Works

1. The user types a message (and optionally attaches a file) in the chat UI.
2. The Flask backend receives the message and transforms it into an n8n-compatible email-shaped payload.
3. The payload is forwarded to the configured n8n webhook endpoint.
4. The n8n workflow processes the message through the Patchbay AI agent pipeline and returns a response.
5. The response is displayed in the chat UI.

---

## Project Structure

```
ChatUI/
├── app.py              # Flask app and n8n payload builder
├── config.json         # Runtime configuration (not committed with secrets)
├── requirements.txt    # Python dependencies
├── Dockerfile          # Container definition
├── static/
│   ├── css/style.css   # UI styles
│   └── js/app.js       # Frontend chat logic
└── templates/
    └── index.html      # Chat UI template
```
