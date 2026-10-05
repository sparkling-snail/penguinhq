#!/bin/bash
# Adapted from Claude-Office (github.com/W17ant/Claude-Office, MIT).
# Forwards a Claude Code hook payload (read from stdin, per Claude Code's
# hook JSON contract: session_id, hook_event_name, tool_name, ...) to
# PenguinHQ's API, which maps it to an agent state change and broadcasts
# it over the existing WebSocket. See apps/api/app/api/routes/hooks.py.
#
# Reads stdin synchronously first, then backgrounds the actual network
# call with a short timeout — a slow or unreachable API must never add
# latency to the tool call this hook is attached to.

payload=$(cat)
(curl -s --max-time 2 -X POST http://localhost:8000/hooks/event \
  -H "Content-Type: application/json" \
  -d "$payload" >/dev/null 2>&1 &)
exit 0
