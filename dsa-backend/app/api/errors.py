from fastapi import HTTPException, status


def user_not_found_exception():
    return HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail="User not found",
    )


def user_already_exists_exception():
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="User already exists",
    )


def invalid_credentials_exception():
    return HTTPException(
        status_code=status.HTTP_401_UNAUTHORIZED,
        detail="Could not validate credentials",
        headers={"WWW-Authenticate": "Bearer"},
    )


def inactive_user_exception():
    return HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="Inactive user",
    )
