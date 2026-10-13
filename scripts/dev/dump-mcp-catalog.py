"""Write the opentrading MCP server's tools/list to a fixture for the routing eval.

Run from an opentrading-mcp checkout (no network, no keys):
    uv run python ../OpenTrading/scripts/dev/dump-mcp-catalog.py \
        ../OpenTrading/test/fixtures/mcp-catalog/opentrading.json <commit>
"""

import asyncio
import datetime
import json
import sys

from opentrading_mcp.server import create_server, register_all


async def main(out_path: str, commit: str) -> None:
    server = create_server()
    register_all(server)
    tools = await server.list_tools()
    payload = {
        "source": "captured",
        "capturedAt": datetime.date.today().isoformat(),
        "server": "opentrading",
        "commit": commit,
        "note": (
            "tools/list of opentrading-mcp at this commit. Regenerate from the opentrading-mcp "
            "checkout: uv run python ../OpenTrading/scripts/dev/dump-mcp-catalog.py "
            "../OpenTrading/test/fixtures/mcp-catalog/opentrading.json <commit>"
        ),
        "tools": [
            {
                "name": t.name,
                "description": t.description or "",
                "inputSchema": t.inputSchema,
                "_meta": t.meta or {},
            }
            for t in tools
        ],
    }
    with open(out_path, "w", encoding="utf-8", newline="") as f:
        json.dump(payload, f, ensure_ascii=False, indent=1)
        f.write("\n")
    print(f"{len(tools)} tools -> {out_path}")


if __name__ == "__main__":
    asyncio.run(main(sys.argv[1], sys.argv[2] if len(sys.argv) > 2 else "unknown"))
