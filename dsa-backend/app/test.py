'''
# 実行方法
* backendコンテナの"/app/app"ディレクトリで以下のコマンドを実行

$ pytest test.py

* 例) DEBUGレベル以上のログを出力したい場合は、以下のコマンドを実行

$ pytest --log-cli-level=DEBUG test.py
'''

from fastapi.testclient import TestClient
from fastapi import HTTPException
from . import app
from dotenv import load_dotenv
from app import constants
import logging
load_dotenv()

client = TestClient(app)

logger = logging.getLogger(__name__)


client = TestClient(app)

logger = logging.getLogger(__name__)


user_accounts = [
    {
        "user_id": "20240001",
        "username": "jong_xina",
        "email": "jong_xina@tsukuba.ac.jp",
        "plain_password": "jong_xinaaaaaa",
        "role": "student",
        "disabled": False,
        "active_start_date": None,
        "active_end_date": None
    },
    {
        "user_id": "20240002",
        "username": "dwayne_wok",
        "email": "dwayne_wok@tsukuba.ac.jp",
        "plain_password": "duuuuuun",
        "role": "student",
        "disabled": False,
    },
    {
        "user_id": "20240003",
        "username": "sponge_bob",
        "email": "sponge_bob@tsukuba.ac.jp",
        "plain_password": "spooooooooo",
        "role": "student",
        "disabled": False,
    },
    {
        "user_id": "20240004",
        "username": "Yi Long Ma",
        "email": "yilong_ma@tsukuba.ac.jp",
        "plain_password": "make_china_great_again",
        "role": "student",
        "disabled": False,
    }
]


class AdminAccount:
    def __init__(self):
        self.access_token = None
        self.refresh_token = None
        self.client = client
    
    def __enter__(self):
        response = self.client.post(
            url="/api/v1/authorize/token",
            headers={
                "accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            data={
                "username": constants.ADMIN_USER_ID,
                "password": constants.ADMIN_PASSWORD
            }
        )
        
        assert response.status_code == 200
        
        self.access_token = response.json()["access_token"]
        
        # リフレッシュトークンをクッキーから取得
        refresh_token = response.cookies["refresh_token"]
        
        self.refresh_token = refresh_token
        
        return self

    def __exit__(self, exc_type, exc_value, traceback):
        response = self.client.post(
            url="/api/v1/authorize/logout",
            headers={
                "accept": "application/json",
                "Authorization": f"Bearer {self.access_token}"
            }
        )
        
        self.client.cookies.clear()        
        assert response.status_code == 200


class ExampleAccountSetting:
    def __init__(self):
        self.client = client
    
    def __enter__(self):
        with AdminAccount() as admin:
            # create user accounts
            for user in user_accounts:
                response = self.client.post(
                    url="/api/v1/users/register",
                    headers={
                        "accept": "application/json",
                        "Authorization": f"Bearer {admin.access_token}"
                    },
                    json=user
                )
                
                assert response.status_code == 200
                logger.info(response.json())

        return self
    
    def __exit__(self, exc_type, exc_value, traceback):
        # remove user accounts
        with AdminAccount() as admin:
            user_ids = [user["user_id"] for user in user_accounts]

            response = self.client.post(
                url=f"/api/v1/users/delete",
                headers={
                    "accept": "application/json",
                    "Authorization": f"Bearer {admin.access_token}"
                },
                json={"user_ids": user_ids}
            )

            assert response.status_code == 200
            logger.info(response.json())


class StudentAccount:
    def __init__(self, user_id: str):
        self.user_id = user_id
        self.access_token = None
        self.refresh_token = None
        self.client = client
    
    def __enter__(self):
        response = self.client.post(
            url="/api/v1/authorize/token",
            headers={
                "accept": "application/json",
                "Content-Type": "application/x-www-form-urlencoded"
            },
            data={
                "username": self.user_id,
                "password": user_accounts[self.user_id]["plain_password"]
            }
        )
        
        assert response.status_code == 200
        
        self.access_token = response.json()["access_token"]
        
        return self
        
    def __exit__(self, exc_type, exc_value, traceback):
        response = self.client.post(
            url="/api/v1/authorize/logout",
            headers={
                "accept": "application/json",
                "Authorization": f"Bearer {self.access_token}"
            }
        )
        
        self.client.cookies.clear()
        
        assert response.status_code == 200


def test_admin():
    with ExampleAccountSetting():
        with AdminAccount() as admin:
            # ユーザリストの取得
            for user in user_accounts:
                response = client.get(
                    url="/api/v1/users/all",
                    headers={
                        "accept": "application/json",
                        "Authorization": f"Bearer {admin.access_token}"
                    },
                    params={"user_id": user["user_id"]}
                )
                
                assert response.status_code == 200
                logger.info(response.json())
    
    try:
        # ログインしていない状態でユーザリストの取得を試みる。
        response = client.get(
            url="/api/v1/users/all",
            headers={"accept": "application/json"}
        )
        
        assert response.status_code == 401
    except HTTPException as e:
        logger.info(e)
