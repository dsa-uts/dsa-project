import logging
from logging.handlers import TimedRotatingFileHandler
from .json_formatter import JsonFormatter

judge_logger = logging.getLogger("judge")
# コンソールに表示するようのハンドラ
console_handler = logging.StreamHandler()
# DEBUG, INFO情報は量が過剰になるので、直近10日間のログ以外は保存しない
debug_handler =  TimedRotatingFileHandler(filename="/logs/5DEBUG.log", when='D', interval=1, backupCount=10, encoding="utf-8")
info_handler = TimedRotatingFileHandler(filename="/logs/4INFO.log", when='D', interval=1, backupCount=10, encoding="utf-8")
# WARNING, ERROR, CRITICALは重要なので、永続的に保存する
warning_handler = logging.FileHandler(filename="/logs/3WARNING.log", mode="a", encoding="utf-8")
error_handler = logging.FileHandler(filename="/logs/2ERROR.log", mode="a", encoding="utf-8")
critical_handler = logging.FileHandler(filename="/logs/1CRITICAL.log", mode="a", encoding="utf-8")

# フォーマット指定
#   コンソール:
console_formatter = logging.Formatter(
    fmt="{asctime} - {levelname}:{name} - {message} (at {module}:{funcName}:{lineno})",
    style="{",
    datefmt="%Y-%m-%d %H:%M",
)
console_handler.setFormatter(console_formatter)

#  ファイル: JSONL形式
file_formatter = JsonFormatter(
    fmt_dict={
        "timestamp": "asctime",
        "message": "message",
        "processName": "processName",
        "processID": "process",
        "threadID": "thread",
        "module": "module",
        "funcName": "funcName",
        "lineno": "lineno"
    }
)
debug_handler.setFormatter(file_formatter)
info_handler.setFormatter(file_formatter)
warning_handler.setFormatter(file_formatter)
error_handler.setFormatter(file_formatter)
critical_handler.setFormatter(file_formatter)
# 出力レベルの設定
# ロガーは全てのログを受け取る
judge_logger.setLevel(level='DEBUG')
judge_logger.propagate = False
# この内、INFOレベル以上のものをコンソールに出力する
console_handler.setLevel(level='INFO')

# フィルタの設定
class LevelFilter(logging.Filter):
    def __init__(self, level):
        self.level = level

    def filter(self, record: logging.LogRecord):
        return record.levelno == self.level

# 各ハンドラは対応するレベルのログのみをキャプチャするように、フィルタを設定する。
debug_handler.addFilter(LevelFilter(logging.DEBUG))
info_handler.addFilter(LevelFilter(logging.INFO))
warning_handler.addFilter(LevelFilter(logging.WARNING))
error_handler.addFilter(LevelFilter(logging.ERROR))
critical_handler.addFilter(LevelFilter(logging.CRITICAL))

# ハンドラの登録
judge_logger.addHandler(console_handler)
judge_logger.addHandler(debug_handler)
judge_logger.addHandler(info_handler)
judge_logger.addHandler(warning_handler)
judge_logger.addHandler(error_handler)
judge_logger.addHandler(critical_handler)

