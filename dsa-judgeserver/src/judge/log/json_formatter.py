import logging
import json

"""
Usage:

 json_handler = FileHandler("foo.json")
    json_formatter = JsonFormatter({"level": "levelname", 
                                    "message": "message", 
                                    "loggerName": "name", 
                                    "processName": "processName",
                                    "processID": "process", 
                                    "threadName": "threadName", 
                                    "threadID": "thread",
                                    "timestamp": "asctime"})
    json_handler.setFormatter(json_formatter)
    
  In this example, record.levelname is mapped to "level",
  record.process is mapped to "processID", and so on.
"""


class JsonFormatter(logging.Formatter):
    """
    Formatter that outputs JSON strings after parsing the LogRecord.
    reference: https://stackoverflow.com/questions/50144628/python-logging-into-file-as-a-dictionary-or-json

    @param dict fmt_dict: Key: logging format attribute pairs. Defaults to {"message": "message"}.
    @param str date_fmt: time.strftime() format string. Default: "%Y-%m-%d %H:%M:%S %Z"
    """

    def __init__(self, fmt_dict: dict = None, date_fmt: str = "%Y-%m-%d %H:%M:%S %Z"):
        self.fmt_dict = fmt_dict if fmt_dict is not None else {"message": "message"}
        self.datefmt = date_fmt

    def usesTime(self) -> bool:
        """
        Overwritten to look for the attribute in the format dict values instead of the fmt string.
        """
        return "asctime" in self.fmt_dict.values()

    def formatMessage(self, record) -> dict:
        """
        Overwritten to return a dictionary of the relevant LogRecord attributes instead of a string.
        KeyError is raised if an unknown attribute is provided in the fmt_dict.
        """
        return {
            fmt_key: record.__dict__[fmt_val]
            for fmt_key, fmt_val in self.fmt_dict.items()
        }

    def format(self, record) -> str:
        """
        Mostly the same as the parent's class method, the difference being that a dict is manipulated and dumped as JSON
        instead of a string.
        """
        record.message = record.getMessage()

        if self.usesTime():
            record.asctime = self.formatTime(record, self.datefmt)

        message_dict = self.formatMessage(record)

        if record.exc_info:
            # Cache the traceback text to avoid converting it multiple times
            # (it's constant anyway)
            if not record.exc_text:
                record.exc_text = self.formatException(record.exc_info)

        if record.exc_text:
            message_dict["exc_info"] = record.exc_text

        if record.stack_info:
            message_dict["stack_info"] = self.formatStack(record.stack_info)

        return json.dumps(message_dict, default=str, ensure_ascii=False)
