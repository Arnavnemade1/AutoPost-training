"""python -m services.core.hephaestus chats | check-access | run | check-model | azure-request"""

import argparse
import os
import sys

from dotenv import load_dotenv

from services.core import store
from services.core.hephaestus import brain, imessage, tools
from services.core.hephaestus.service import LABEL, Service


def chat_id():
    found = os.environ.get("FORGE_HEPHAESTUS_CHAT")
    if not found:
        raise SystemExit("Set FORGE_HEPHAESTUS_CHAT to an id from: python -m services.core.hephaestus chats")
    return found


def check_access(path=imessage.DATABASE):
    """Prove this process can read the Messages database, without showing or reading a message."""
    chat = chat_id()
    try:
        found = imessage.count(chat, path)
    except imessage.MessagesError as error:
        print(error)
        return 2
    print("Full Disk Access: working. The Messages database can be read.")
    print(f"Chat {chat}: {found} messages." if found else f"Chat {chat}: not found yet.")
    if not found:
        print("Send yourself one message in the Messages app to create that thread, then check again.")
    print("No message text was read or shown.")
    return 0 if found else 1


def main(argv=None):
    load_dotenv(store.ROOT / ".env")
    parser = argparse.ArgumentParser(prog="python -m services.core.hephaestus")
    commands = parser.add_subparsers(dest="command", required=True)
    commands.add_parser("chats", help="List group chats and their ids. Reads no message text")
    commands.add_parser("check-access", help="Prove Messages can be read, showing no message text")
    commands.add_parser("run", help="Join the configured chat and keep working")
    commands.add_parser("check-model", help="Make one small call to the connected model")
    request = commands.add_parser("azure-request", help="Show the request for a friend's Azure model")
    request.add_argument("--to")
    request.add_argument("--send", action="store_true", help="Post it to the group chat")
    args = parser.parse_args(argv)

    if args.command == "chats":
        for chat in imessage.chats():
            print(f"{chat['id']}\t{chat['name'] or '(unnamed)'}\t{chat['people']}")
        return 0
    if args.command == "check-access":
        return check_access()
    if args.command == "check-model":
        if not brain.connected():
            print("No model connected. See Connecting a friend's Azure model in docs/hephaestus.md.")
            return 1
        try:
            brain.call_model({"model": brain.model_name(), "max_output_tokens": 16, "input": "Reply OK."})
        except Exception as error:  # A provider's message can echo what it was sent.
            print(f"{brain.provider()} did not answer ({type(error).__name__}).")
            return 1
        print(f"{brain.provider()} answered, using {brain.model_name()}.")
        return 0
    if args.command == "azure-request":
        text = tools.azure_request(args.to)
        if args.send:
            imessage.send(chat_id(), LABEL + text)
            print("Posted.")
        else:
            print(LABEL + text)
        return 0
    return Service(chat_id()).run()


if __name__ == "__main__":
    sys.exit(main())
