"""
A headless (no-display) replacement for the GUI manager.

Implements the same interface that the core expects from `gui.GUIManager`,
so the miner can run on systems without a display server or Tkinter
(e.g. an OpenWrt router). Selected with the `--headless` command line flag.

The output is written to stdout, which makes it suitable for supervision
by procd (OpenWrt), systemd, or a container runtime.
"""
from __future__ import annotations

import asyncio
import logging
from collections import abc
from datetime import datetime
from typing import Any, TypeVar, TYPE_CHECKING

from translate import _
from exceptions import ExitRequest, LoginException

if TYPE_CHECKING:
    from twitch import Twitch
    from utils import Game
    from channel import Channel
    from inventory import TimedDrop, DropsCampaign

logger = logging.getLogger("TwitchDrops")

_T = TypeVar("_T")


class _Tray:
    """Tray icon replacement - all operations are no-ops."""

    def change_icon(self, state: str) -> None:
        pass

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

    def update(self, idx: int, status: str | None = None, topics: int | None = None) -> None:
        pass

    def remove(self, idx: int) -> None:
        pass


class _Progress:
    """Progress display replacement.

    `minute_almost_done()` mirrors the GUI semantics of "no countdown timer
    is running", which is the correct default when no drop is ever displayed:
    it enables the GQL CurrentDrop query and the optimistic minute bumping
    fallback in the watch loop.
    """

    def display(self, drop: TimedDrop | None, *, countdown: bool = True, subone: bool = False) -> None:
        pass

    def start_timer(self) -> None:
        pass

    def stop_timer(self) -> None:
        pass

    def minute_almost_done(self) -> bool:
        return True


class _Channels:
    """Channel list replacement - there is no manual channel selection."""

    def get_selection(self) -> None:
        return None

    def clear(self) -> None:
        pass

    def display(self, channel: Channel, *, add: bool = False) -> None:
        pass

    def remove(self, channel: Channel) -> None:
        pass

    def set_watching(self, channel: Channel) -> None:
        pass

    def clear_watching(self) -> None:
        pass


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
    """

    def __init__(self, twitch: Twitch):
        self._twitch: Twitch = twitch
        self._close_requested = asyncio.Event()
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
        pass

    def stop(self) -> None:
        self.progress.stop_timer()

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
