import logging
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger("uvicorn")

class StandardChecker:
    @staticmethod
    def match(ls: str, rs: str) -> bool:
        # テキストを行単位に分割
        ls_lines = ls.splitlines()
        rs_lines = rs.splitlines()
        
        # 半角・全角空白、およびタブ文字を除去
        # python 3系のstrはUnicodeで、Unicodeの"White_Space"プロパティが"yes"の
        # 文字は空白文字として判定される
        # 全角空白もタブ文字も半角文字も、その他の空白文字も、トリムで除去される
        # https://discuss.python.org/t/add-space-format-characters-to-str-strip/7788
        ls_lines = [line.strip() for line in ls_lines]
        rs_lines = [line.strip() for line in rs_lines]
        
        # 空白行を除去
        ls_lines = [line for line in ls_lines if line != '']
        rs_lines = [line for line in rs_lines if line != '']
                
        # logger.info(f"ls: {ls_lines}, rs: {rs_lines}")

        # 行数が異なる場合はFalse
        if len(ls_lines) != len(rs_lines):
            return False

        # 各行を空白で区切って分割する
        '''
        str.split(sep=None, maxsplit=-1)の公式ドキュメントから
        https://docs.python.org/3/library/stdtypes.html#str.split
        
        If sep is not specified or is None, a different splitting algorithm is
        applied: runs of consecutive whitespace are regarded as a single
        separator, and the result will contain no empty strings at the start or
        end if the string has leading or trailing whitespace. Consequently,
        splitting an empty string or a string consisting of just whitespace with
        a None separator returns [].
        
        なので、セパレーターの定義は無しでよい。
        '''
        
        ls_lines = [line.split() for line in ls_lines]
        rs_lines = [line.split() for line in rs_lines]
        
        # logger.info(f"ls_lines: {ls_lines}, rs_lines: {rs_lines}")
        
        # 各行を比較
        for ls_line, rs_line in zip(ls_lines, rs_lines):
            if ls_line != rs_line:
                return False

        return True
