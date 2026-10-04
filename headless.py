"""
A headless (no-display) replacement for the GUI manager.

Implements the same interface that the core expects from `gui.GUIManager`,
so the miner can run on systems without a display server or Tkinter
(e.g. an OpenWrt router). Selected with the `--headless` command line flag.

The output is written to stdout, which makes it suitable for supervision
by procd (OpenWrt), systemd, or a container runtime. A JSON status file is
written periodically as well, which is what the LuCI interface reads.
"""
from __future__ import annotations

import asyncio
import logging
from time import time
from collections import abc
from datetime import datetime
from typing import Any, TypeVar, TYPE_CHECKING

from translate import _
from exceptions import ExitRequest, LoginException
from constants import STATUS_PATH
from utils import json_save

if TYPE_CHECKING:
    from twitch import Twitch
    from utils import Game
    from channel import Channel
    from inventory import TimedDrop, DropsCampaign

logger = logging.getLogger("TwitchDrops")

_T = TypeVar("_T")
# how often the status file is refreshed, in seconds
STATUS_INTERVAL = 2


class _Tray:
    """Tray icon replacement - records the icon state for status reporting."""

    def __init__(self) -> None:
        self.state: str = "pickaxe"

    def change_icon(self, state: str) -> None:
        self.state = state

    def notify(self, message: str, title: str | None = None, duration: float = 10) -> None:
        pass

    def update_title(self, drop: TimedDrop | None) -> None:
        pass

    def stop(self) -> None:
        pass


class _Status:
    """Status bar replacement - keeps the last text for status reporting."""

    def __init__(self) -> None:
        self.text: str = ''

    def update(self, text: str) -> None:
        self.text = text
        logger.debug(f"Status: {text}")


class _Websockets:
    """Websocket status panel replacement."""

    def __init__(self) -> None:
        self.items: dict[int, dict[str, Any]] = {}

    def update(self, idx: int, status: str | None = None, topics: int | None = None) -> None:
        item = self.items.setdefault(idx, {"status": None, "topics": 0})
        if status is not None:
            item["status"] = status
        if topics is not None:
            item["topics"] = topics

    def remove(self, idx: int) -> None:
        self.items.pop(idx, None)


class _Progress:
    """Progress display replacement.

    `minute_almost_done()` mirrors the GUI semantics of "no countdown timer
    is running", which is the correct default when no drop is ever displayed:
    it enables the GQL CurrentDrop query and the optimistic minute bumping
    fallback in the watch loop.
    """

    def __init__(self) -> None:
        self.drop: TimedDrop | None = None

    def display(self, drop: TimedDrop | None, *, countdown: bool = True, subone: bool = False) -> None:
        self.drop = drop

    def start_timer(self) -> None:
        pass

    def stop_timer(self) -> None:
        pass

    def minute_almost_done(self) -> bool:
        return True


class _Channels:
    """Channel list replacement - there is no manual channel selection."""

    def __init__(self) -> None:
        self.items: dict[int, Channel] = {}
        self.watching: Channel | None = None

    def get_selection(self) -> None:
        return None

    def clear(self) -> None:
        self.items.clear()

    def display(self, channel: Channel, *, add: bool = False) -> None:
        self.items[channel.id] = channel

    def remove(self, channel: Channel) -> None:
        self.items.pop(channel.id, None)

    def set_watching(self, channel: Channel) -> None:
        self.watching = channel

    def clear_watching(self) -> None:
        self.watching = None


class _Inventory:
    """Inventory tab replacement."""

    def clear(self) -> None:
        pass

    def update_drop(self, drop: TimedDrop) -> None:
        pass

    async def add_campaign(self, campaign: DropsCampaign) -> None:
        # NOTE: this is awaited by the core via asyncio.as_completed
        pass


class _Button:
    """A dummy Tk widget replacement, supporting the `.config()` calls."""

    def config(self, **kwargs: Any) -> None:
        pass


class _Help:
    """Help tab replacement."""

    def __init__(self) -> None:
        self._invalidate_button = _Button()


class _Login:
    """Login form replacement.

    Headless login uses the OAuth device code flow: the code is printed to
    stdout (and kept for status reporting), and the flow continues without
    waiting for any user interaction in the app itself.
    """

    def __init__(self) -> None:
        self.device_code: dict[str, str] | None = None

    def update(self, status: str, user_id: int | None) -> None:
        if self.device_code is not None and user_id is not None:
            # login has completed - the device code is not needed anymore
            self.device_code = None
        logger.debug(f"Login status: {status}")

    def clear(self, login: bool = False, password: bool = False, token: bool = False) -> None:
        pass

    async def ask_login(self) -> Any:
        # NOTE: the password login flow is not reachable in headless mode
        # without user input; the device code flow is used instead
        raise LoginException(
            "Interactive login is not available in headless mode - "
            "provide a valid cookies.jar, or use the device code flow"
        )

    async def ask_enter_code(self, page_url: Any, user_code: str) -> None:
        self.device_code = {
            "user_code": user_code,
            "verification_uri": str(page_url),
        }
        self._print(_("gui", "login", "request"))
        self._print(f"Enter this code on the Twitch's device activation page: {user_code}")
        self._print(f"Verification URL: {page_url}")

    def _print(self, message: str) -> None:
        stamp = datetime.now().strftime("%X")
        print(f"{stamp}: {message}", flush=True)


class HeadlessUI:
    """A no-display replacement for `gui.GUIManager`.

    Provides the interface required by the core (`twitch.Twitch`), the
    websocket pool, channels and inventory objects. Purely cosmetic calls
    are no-ops; the behavioral parts (close handling, login, channel
    selection, progress timing) are implemented to match the GUI semantics.

    A JSON snapshot of the current state is written to `STATUS_PATH`
    periodically, which is what the LuCI interface displays.
    """

    def __init__(self, twitch: Twitch):
        self._twitch: Twitch = twitch
        self._close_requested = asyncio.Event()
        self._status_task: asyncio.Task[None] | None = None
        # interface components
        self.tray = _Tray()
        self.status = _Status()
        self.websockets = _Websockets()
        self.progress = _Progress()
        self.channels = _Channels()
        self.inv = _Inventory()
        self.login = _Login()
        self.help = _Help()

    @property
    def close_requested(self) -> bool:
        return self._close_requested.is_set()

    async def wait_until_closed(self) -> None:
        # wait until the application is requested to close
        await self._close_requested.wait()

    async def coro_unless_closed(self, coro: abc.Awaitable[_T]) -> _T:
        # In Python 3.11, we need to explicitly wrap awaitables
        tasks = [asyncio.ensure_future(coro), asyncio.ensure_future(self._close_requested.wait())]
        done: set[asyncio.Task[Any]]
        pending: set[asyncio.Task[Any]]
        done, pending = await asyncio.wait(tasks, return_when=asyncio.FIRST_COMPLETED)
        for task in pending:
            task.cancel()
        if self._close_requested.is_set():
            raise ExitRequest()
        return await next(iter(done))

    def prevent_close(self) -> None:
        self._close_requested.clear()

    def close(self, *args: Any) -> int:
        """
        Requests the application to close.
        """
        self._close_requested.set()
        # notify client we're supposed to close
        self._twitch.close()
        return 0

    def start(self) -> None:
        if self._status_task is None:
            self._status_task = asyncio.create_task(self._status_writer())

    def stop(self) -> None:
        self.progress.stop_timer()
        if self._status_task is not None:
            self._status_task.cancel()
            self._status_task = None

    def close_window(self) -> None:
        pass

    def save(self, *, force: bool = False) -> None:
        pass

    def grab_attention(self, *, sound: bool = True) -> None:
        pass

    def set_games(self, games: set[Game]) -> None:
        pass

    def display_drop(self, drop: TimedDrop, *, countdown: bool = True, subone: bool = False) -> None:
        pass

    def clear_drop(self) -> None:
        pass

    def print(self, message: str) -> None:
        # log the message, so that it ends up in the log file too (if --log is used)
        logger.info(message)
        # print to stdout, which is captured by the service supervisor
        stamp = datetime.now().strftime("%X")
        if '\n' in message:
            message = message.replace('\n', f"\n{stamp}: ")
        print(f"{stamp}: {message}", flush=True)

    # status reporting

    async def _status_writer(self) -> None:
        while True:
            try:
                json_save(STATUS_PATH, self._snapshot(), sort=True)
            except Exception:
                logger.debug("Failed to write the status file", exc_info=True)
            await asyncio.sleep(STATUS_INTERVAL)

    def _snapshot(self) -> dict[str, Any]:
        twitch = self._twitch
        auth_state = getattr(twitch, "_auth_state", None)
        logged_in = getattr(auth_state, "_logged_in", None)

        data: dict[str, Any] = {
            "ts": round(time(), 3),
            "state": getattr(getattr(twitch, "_state", None), "name", None),
            "status": self.status.text,
            "tray": self.tray.state,
            "auth": {
                "logged_in": bool(logged_in is not None and logged_in.is_set()),
                "user_id": getattr(auth_state, "user_id", None),
                "device_code": self.login.device_code,
            },
            "progress": self._drop_snapshot(),
            "channels": self._channels_snapshot(),
            "websockets": [
                {
                    "index": idx,
                    "status": item.get("status"),
                    "topics": item.get("topics", 0),
                }
                for idx, item in sorted(self.websockets.items.items())
            ],
        }
        return data

    def _drop_snapshot(self) -> dict[str, Any] | None:
        drop = self.progress.drop
        if drop is None:
            return None
        campaign = drop.campaign
        game = getattr(campaign, "game", None)
        return {
            "drop": {
                "id": getattr(drop, "id", None),
                "name": drop.name,
                "rewards": drop.rewards_text(),
                "progress": round(drop.progress, 4),
                "current_minutes": drop.current_minutes,
                "required_minutes": drop.required_minutes,
                "remaining_minutes": drop.remaining_minutes,
                "is_claimed": drop.is_claimed,
                "can_claim": drop.can_claim,
            },
            "campaign": {
                "id": getattr(campaign, "id", None),
                "name": campaign.name,
                "game": game.name if game is not None else None,
                "progress": round(campaign.progress, 4),
                "claimed_drops": campaign.claimed_drops,
                "total_drops": campaign.total_drops,
                "remaining_minutes": campaign.remaining_minutes,
            },
        }

    def _channels_snapshot(self) -> list[dict[str, Any]]:
        channels = []
        for channel in self.channels.items.values():
            game = getattr(channel, "game", None)
            channels.append({
                "id": channel.id,
                "name": channel.name,
                "game": game.name if game is not None else None,
                "viewers": getattr(channel, "viewers", None),
                "online": channel.online,
                "pending": channel.pending_online,
                "drops_enabled": channel.drops_enabled,
                "acl_based": channel.acl_based,
                "watching": channel is self.channels.watching,
            })
        channels.sort(key=lambda item: (not item["watching"], -(item["viewers"] or 0)))
        return channels
