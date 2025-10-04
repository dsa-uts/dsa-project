// DialogComponent.tsx
import React from "react";
import styled from "styled-components";
import ButtonComponent from "./ButtonComponent";

interface DialogProps {
    title: string;
    body: React.ReactNode;
    buttons: React.ReactNode[]; // ButtonComponentを渡すためのプロパティ
    onClose: () => void; // ダイアログを閉じるときの処理
}

const Dialog: React.FC<DialogProps> = ({ title, body, buttons, onClose }) => {
    return (
        <Wrapper>
            <DialogBox>
                <Title>{title}</Title>
                <ScrollableBody>{body}</ScrollableBody>
                <ButtonSection>
                    {buttons.map((button, index) => (
                        <ButtonWrapper key={index}>{button}</ButtonWrapper>
                    ))}
                </ButtonSection>
            </DialogBox>
            <Overlay onClick={onClose} />
        </Wrapper>
    );
};

export default Dialog;

// スタイル定義
const Wrapper = styled.div`
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    display: flex;
    justify-content: center;
    align-items: center;
    z-index: 1000;
`;

const DialogBox = styled.div`
    background-color: white;
    padding: 20px;
    border-radius: 8px;
    box-shadow: 0 2px 10px rgba(0, 0, 0, 0.2);
    z-index: 1001;
    min-width: 300px;
    max-width: 500px;
    display: flex;
    flex-direction: column;
    max-height: 80vh;
`;

const Title = styled.h1`
    margin-top: 0;
    margin-bottom: 16px;
`;

const ScrollableBody = styled.div`
    margin-bottom: 24px;
    overflow-y: auto;
    max-height: calc(80vh - 150px); // タイトルとボタンの高さを考慮
    padding-right: 10px; // スクロールバーのスペース
`;

const ButtonSection = styled.div`
    display: flex;
    flex-direction: row;
    gap: 10px;
`;

const ButtonWrapper = styled.div`
    width: 100%;
    display: flex;
    justify-content: center;
`;

const Overlay = styled.div`
    position: fixed;
    top: 0;
    left: 0;
    width: 100vw;
    height: 100vh;
    background-color: rgba(0, 0, 0, 0.5);
    z-index: 1000;
`;
