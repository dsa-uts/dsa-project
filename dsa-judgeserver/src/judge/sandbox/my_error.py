# エラーメッセージの型
class Error:
    message: str  # エラーメッセージ

    def __init__(self, message: str):
        self.message = message

    def __str__(self):
        return f"Error(message=\"{self.message}\")"
    
    def silence(self) -> bool:
        return self.message == ""
    
    @staticmethod
    def Nothing() -> 'Error':
        """
        エラーが発生していない状態を表すErrorオブジェクトを返します。
        
        Returns:
            Error: メッセージが空文字列のErrorオブジェクト
        """
        return Error("")

    @staticmethod
    def Silence() -> 'Error':
        """
        エラーが発生していない状態を表すErrorオブジェクトを返します。Nothing()と同じ動作です。
        
        Returns:
            Error: メッセージが空文字列のErrorオブジェクト
        """
        return Error("")
