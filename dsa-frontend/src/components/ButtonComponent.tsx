import styled from "styled-components";
import React from "react";

type ButtonComponentPropsBase = {
    label: string;
    disabled?: boolean;
    width?: string;
    height?: string;
    fontSize?: string;
    style?: React.CSSProperties;
};

type ButtonComponentPropsWithClick = ButtonComponentPropsBase & {
    type?: 'button';
    onClick: (event: React.MouseEvent<HTMLButtonElement>) => void;
};

type ButtonComponentPropsWithoutClick = ButtonComponentPropsBase & {
    type: 'submit' | 'reset';
    onClick?: never;
};

type ButtonComponentProps = ButtonComponentPropsWithClick | ButtonComponentPropsWithoutClick;

const ButtonComponent: React.FC<ButtonComponentProps> = ({ onClick, label, type = 'button', disabled = false, width, height, fontSize = '16px', style }) => {
    return (
        <StyledButton 
            onClick={onClick}
            type={type}
            disabled={disabled} 
            width={width}
            height={height}
            fontSize={fontSize}
            style={style}
        >
            {label}
        </StyledButton>
    );
};

export default ButtonComponent;

const StyledButton = styled.button<{ width?: string; height?: string; fontSize?: string }>`
    background-color: white;
    border: 1px solid black;
    border-radius: 15px;
    color: black;
    font-size: ${(props) => props.fontSize || '16px'};
    cursor: pointer;
    width: ${(props) => props.width || 'auto'};
    height: ${(props) => props.height || 'auto'};
    transition: background-color 0.1s;
    white-space: nowrap;
    padding: 0 12px;

    &:hover {
        background-color: #B8B8B8;
    }

    &:active {
        background-color: #898989;
    }

    &:disabled {
        background-color: white;
        color: #D9D9D9;
        border-color: #D9D9D9;
        cursor: not-allowed;
    }
`;