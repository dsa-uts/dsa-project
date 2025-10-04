from app.classes import schemas
from app.api.api_v1.endpoints import authenticate_util
from fastapi import HTTPException, status
from pathlib import Path
import zipfile
import shutil


# 授業エントリに紐づくデータ(授業エントリ、課題エントリ、評価項目、テストケース)が公開期間内かどうかを確認する
def lecture_is_public(lecture_entry: schemas.Lecture) -> bool:
    return authenticate_util.is_past(
        lecture_entry.start_date
    ) and authenticate_util.is_future(lecture_entry.end_date)


def access_sanitize(
    all: bool | None = None,  # 全ての授業エントリを取得するかどうか
    eval: bool | None = None,  # 課題採点かどうか
    role: schemas.Role | None = None,  # ユーザのロール
) -> None:
    """
    アクセス権限のチェックを行う
    """
    if role not in [schemas.Role.manager, schemas.Role.admin]:
        # ユーザがManager, Adminでない場合は、全ての授業エントリを取得することはできない
        if all is not None and all is True:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="公開期間外の情報を取得する権限がありません",
            )
        # ユーザがManager, Adminでない場合は、課題採点のリソースにアクセスすることはできない
        if eval is not None and eval is True:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="課題採点を行う権限がありません",
            )


def get_zip_file_size(path: Path) -> int:
    """
    zipファイルの容量をMB単位で返す
    """
    with zipfile.ZipFile(path, "r") as zip_ref:
        return sum([zinfo.file_size for zinfo in zip_ref.filelist]) / 1024 / 1024 # MB


def unfold_zip(uploaded_zip_file: Path, dest_dir: Path) -> str | None:
    """
    uploaded_zip_fileが以下の条件を満たすかチェックしながら、dest_dirにファイルを配置していく。
    * 拡張子がzipであること
    * 展開後、以下のパターンしか想定しない
        * フォルダが存在しないパターン(zipファイルに直接ファイルを配置していたケース)
        * フォルダが一個しかないパターン(zipファイルにフォルダごと配置していたケース)
        * フォルダが2個以上あるが、zipファイルの名前と同じ名前のフォルダが存在するパターン
          (__MACOSXなどのメタ情報フォルダも含めてzipファイルに配置していたケース)
        
    何も問題が無ければNoneを返し、問題があればエラーメッセージを返す。
    """
    # zip提出の場合
    if not uploaded_zip_file.name.endswith(".zip"):
        return "zipファイルを提出してください。",

    # zipファイルの容量が30MBを超える場合はエラー
    if get_zip_file_size(uploaded_zip_file) > 30:
        return "zipファイルの展開後の容量が30MBを超えています。"

    # 展開する
    try:
        with zipfile.ZipFile(uploaded_zip_file, "r") as zip_ref:
            zip_ref.extractall(dest_dir)
    except Exception as e:
        return f"zipファイルの展開に失敗しました: {e}"
    
    # 空の場合
    if len(list(dest_dir.iterdir())) == 0:
        return "提出ファイルが空です。"
    
    # dest_dir下に1つのフォルダのみがある場合、そのフォルダの中身をdest_dirに移動する
    # (ex "temp_dir/dir"のみ)
    if len(list(dest_dir.iterdir())) == 1 and list(dest_dir.iterdir())[0].is_dir():
        folded_dir = list(dest_dir.iterdir())[0]
        try:
            for file in folded_dir.iterdir():
                shutil.move(file, dest_dir)
        except Exception as e:
            return f"zipファイル名と同じ名前のフォルダがあるため、展開時にエラーが発生しました。"
        
        # folded_dirを削除する
        if len(list(folded_dir.iterdir())) > 0:
            return "フォルダの展開に失敗しました。"
        shutil.rmtree(folded_dir)
    elif (
        len(list(dest_dir.iterdir())) > 1
        and (dest_dir / uploaded_zip_file.stem).exists()
        and (dest_dir / uploaded_zip_file.stem).is_dir()
    ):
        # フォルダが2個以上あるが、zipファイルの名前と同じ名前のフォルダが存在する場合
        # zipファイルの名前と同じフォルダをdest_dirに移動
        try:
            for file in (dest_dir / uploaded_zip_file.stem).iterdir():
                shutil.move(file, dest_dir)
        except Exception as e:
            return f"zipファイルの名前と同じ名前のフォルダがあるため、展開時にエラーが発生しました。"
        shutil.rmtree((dest_dir / uploaded_zip_file.stem))
    
    # 'makefile', 'GNUMakefile'を見つけたら、'Makefile'にリネームする
    for file in dest_dir.iterdir():
        if file.is_file() and file.name in ['makefile', 'GNUMakefile']:
            file.rename(dest_dir / 'Makefile')

    return None
