import React, { useState, useEffect } from 'react';
import useApiClient from '../hooks/useApiClient';
import PasswordBox from '../components/PasswordBox';
import styled from 'styled-components';
import { updatePassword } from '../api/PostAPI';
import { useAuth } from '../context/AuthContext';
import { UserUpdatePassword } from '../types/user';

const StudentPassChangePage = () => {
    const MIN_PASSWORD_LENGTH = 6;
    const MAX_PASSWORD_LENGTH = 50;
    const VALID_CHARACTER_REGEX = /^[A-Za-z0-9!#$%&()\-\^@\[;:\],./=~|{+*}<>\?_]+$/;
    const [currentPassword, setCurrentPassword] = useState('');
    const [newPassword, setNewPassword] = useState('');
    const [confirmNewPassword, setConfirmNewPassword] = useState('');
    const [newPasswordError, setNewPasswordError] = useState('');
    const [confirmPasswordError, setConfirmPasswordError] = useState('');
    const [currentPasswordError, setCurrentPasswordError] = useState('');
    const { token, user_id } = useAuth();
    const { apiClient } = useApiClient();

    const meetLengthCondition = (password: string) => {
        return password.length >= MIN_PASSWORD_LENGTH && password.length <= MAX_PASSWORD_LENGTH
    }

    const meetCharacterCondition = (password: string) => {
        return VALID_CHARACTER_REGEX.test(password)
    }

    const isSamePassword = (pass1: string, pass2: string) => {
        return pass1 == pass2
    }

    const validateNewPassword = (pass1: string, pass2: string) => {
        return (
            meetLengthCondition(pass1) &&
            meetCharacterCondition(pass1) &&
            pass1.length > 0 &&
            isSamePassword(pass1, pass2)
        );
    }

    const handleNewPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const password = e.target.value;
        setNewPassword(password);
    
        if (!meetCharacterCondition(password) && password.length > 0) {
            setNewPasswordError('使用できない文字が含まれています');
        } else if (!meetLengthCondition(password) && password.length > 0) {
            setNewPasswordError(`文字数は${MIN_PASSWORD_LENGTH}文字～${MAX_PASSWORD_LENGTH}文字にしてください．`);
        } else {
            setNewPasswordError('');
        }
    };
    
    const handleConfirmPasswordChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const password = e.target.value;
        setConfirmNewPassword(password);
    
        if (!isSamePassword(newPassword, password) && password.length > 0) {
            setConfirmPasswordError('パスワードが一致しません');
        } else {
            setConfirmPasswordError('');
        }
    };

    if (user_id === null) {
        return <p>ログインしていません。</p>;
    }

    const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
        event.preventDefault();
        const user: UserUpdatePassword = {
            user_id: user_id,
            plain_password: currentPassword,
            new_plain_password: newPassword
        }
        if (validateNewPassword(newPassword, confirmNewPassword) && currentPassword.length > 0) {
            try {
                await apiClient({apiFunc: updatePassword, args: [user, token]});
                alert('パスワードを変更しました．');
            } catch (unknownError) {
                const error = unknownError as any;
                console.error('Failed to update password:', error);
                alert(`パスワードの変更に失敗しました．\n${error.response.data?.detail}`);
            }
        }
    };

    
    return (
        <Container>
            <h1>ユーザー管理</h1>
            <h3>パスワード変更</h3>
            <FormContainer>
                <form onSubmit={handleSubmit}>
                    <FormRow>
                        <Label>現在のパスワード:</Label>
                        <PasswordBox value={currentPassword} onChange={(e) => setCurrentPassword(e.target.value)} style={{ width: '300px' }}/>
                    </FormRow>
                    <FormColumn>
                        <FormRow>
                            <Label>新しいパスワード:</Label>
                            <PasswordBox value={newPassword} onChange={handleNewPasswordChange} style={{ width: '300px' }}/>
                        </FormRow>
                        {newPasswordError && <ErrorText>{newPasswordError}</ErrorText>}
                    </FormColumn>
                    <FormColumn>
                        <FormRow>
                            <Label>新しいパスワード（確認）:</Label>
                            <PasswordBox value={confirmNewPassword} onChange={handleConfirmPasswordChange} style={{ width: '300px' }}/>
                        </FormRow>
                        {confirmPasswordError && <ErrorText>{confirmPasswordError}</ErrorText>}
                    </FormColumn>
                    <button type="submit" disabled={!validateNewPassword(newPassword, confirmNewPassword) || currentPassword.length <= 0}>変更</button>
                </form>
                <CautionBox>
                    <CautionContent>
                        <CautionTitle>注意事項:</CautionTitle>
                        <ul>
                            <li>文字数は{MIN_PASSWORD_LENGTH}文字～{MAX_PASSWORD_LENGTH}文字にしてください．</li>
                            <li>使用できる文字は以下です．
                                <ul>
                                    <li>英大文字 A～Z</li>
                                    <li>英小文字 a～z</li>
                                    <li>数字 0～9</li>
                                    <li>{`記号 ! # $ % & ( ) - ^ @ [ ; : ] , . / = ~ | { + * } < > ? _`}</li>
                                </ul>
                            </li>
                        </ul>
                    </CautionContent>
                </CautionBox>
            </FormContainer>
        </Container>
    );
};

// スタイルをstyled-componentsで定義
const Container = styled.div`
    display: flex;
    flex-direction: column;
`;

const FormContainer = styled.div`
    display: flex;
    flex-direction: row;
    justify-content: flex-start;
    gap: 50px;
`;

const FormRow = styled.div`
    display: flex;
    align-items: center;
    margin-bottom: 10px;
`;

const FormColumn = styled.div`
    display: flex;
    flex-direction: column;
    margin-bottom: 10px;
`;

const Label = styled.label`
    margin-right: 10px;
    width: 150px;
`;

const ErrorText = styled.div`
    color: red;
    margin-top: 5px;
`;

const CautionContent = styled.div`
    position: absolute;
    background: white;
    border: 1px solid black;
    padding: 10px;
`;

const CautionTitle = styled.span`
    color: black;
    font-size: 14px;
    font-family: Inter;
    font-weight: 700;
    word-wrap: break-word;
    margin-bottom: 5px;
`;


const CautionBox = styled.div`
    width: 100%;
    height: 100%;
    position: relative;
`

export default StudentPassChangePage;
