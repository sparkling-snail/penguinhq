"""
Entrypoint for the agent-runner container.

Usage: python -m app.autonomous

Runs all autonomous agents in a single process with shared infrastructure.
Requires ANTHROPIC_API_KEY to be set in the environment.
"""

import asyncio
import logging

from app.autonomous.runtime import AgentRuntime


async def main() -> None:
    runtime = AgentRuntime()
    try:
        await runtime.start()
    except KeyboardInterrupt:
        await runtime.stop()


if __name__ == "__main__":
    logging.basicConfig(
        level=logging.INFO,
        format="%(asctime)s %(name)s %(levelname)s %(message)s",
    )
    asyncio.run(main())
