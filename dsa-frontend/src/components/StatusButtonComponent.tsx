import styled from "styled-components";
import React from "react";
import { Chip, Tooltip } from "@mui/material";
import { Colors } from '../styles/colors';
import { SubmissionSummaryStatus } from "../types/Assignments";

interface StatusButtonProps {
    status: SubmissionSummaryStatus | "提出" | "遅延" | "未提出" | "エラー" | "submitted" | "delay" | "non-submitted";
    isButton?: boolean;
    onClick?: () => void;
    color?: typeof Colors;
}

const statusDescriptions: { [key: string]: string } = {
    AC: "Accepted - 正解",
    WA: "Wrong Answer - 不正解",
    TLE: "Time Limit Exceed - 時間制限超過",
    MLE: "Memory Limit Exceed - メモリ制限超過",
    RE: "Runtime Error - 実行時エラー",
    CE: "Compile Error - コンパイルエラー",
    OLE: "Output Limit Exceed - 出力サイズ超過",
    IE: "Internal Error - 内部エラー",
    FN: "File Not found - ファイル未検出",
    "提出": "提出済み",
    "遅延": "遅延提出",
    "未提出": "未提出",
};

const StatusButton: React.FC<StatusButtonProps> = ({ status, isButton = false, onClick, color = Colors }) => {
    if (status === "submitted") {
        status = "提出";
    } else if (status === "delay") {
        status = "遅延";
    } else if (status === "non-submitted") {
        status = "未提出";
    }
    
    // 略称の場合のみツールチップを表示
    const showTooltip = ["AC", "WA", "TLE", "MLE", "RE", "CE", "OLE", "IE", "FN"].includes(status);

    const getChipColor = (status: string) => {
        if (["AC", "提出"].includes(status)) {
            return color.button.green;
        } else if (["WA", "遅延"].includes(status)) {
            return color.button.yellow;
        } else {
            return color.button.red;
        }
    };

    const chipColors = getChipColor(status);

    const chip = (
        <Chip
            label={status}
            onClick={isButton ? onClick : undefined}
            clickable={isButton}
            sx={{
                backgroundColor: chipColors.base,
                color: 'white',
                fontWeight: 700,
                minWidth: '24px',
                height: '24px',
                borderRadius: '10px',
                '&:hover': isButton ? {
                    backgroundColor: chipColors.hover,
                }: undefined,
                '&:active': isButton ? {
                    backgroundColor: chipColors.active,
                }: undefined,
                cursor: isButton ? 'pointer' : 'default',
                pointerEvents: isButton ? 'auto' : 'all',
            }}
        />
    )
    
    return showTooltip ? (
        <Tooltip
            title={statusDescriptions[status]}
            placement="top"
            arrow
        >
            {chip}
        </Tooltip>
    ) : chip;
};

export default StatusButton;
