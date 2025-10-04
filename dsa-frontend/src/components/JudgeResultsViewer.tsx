import React from 'react';
import { JudgeResult, TestCases } from '../types/Assignments';
import {
  Paper, Typography, Box, TextField, Stack, Divider
} from '@mui/material';
import { styled } from '@mui/material/styles';
import StatusButton from './StatusButtonComponent';

// JudgeResult[]を引数として受け取り、それらを表示するコンポーネント
interface JudgeResultsViewerProps {
  result: JudgeResult;
  testCase: TestCases | undefined;
};

const ScrollableTextField = styled(TextField)({
  '& .MuiInputBase-root': {
    width: '100%',
    position: 'relative',
    '& .MuiInputBase-input': {
      overflow: 'auto !important', // スクロールを有効化
    }
  },
  '& .MuiInputBase-input': {
    fontFamily: 'monospace',
    fontSize: '14px',
    whiteSpace: 'pre',
    wordWrap: 'normal',
    display: 'block',
    minWidth: '100%',
    position: 'relative',
    zIndex: 0,
  },
  width: '100%'
});

const JudgeResultsViewer: React.FC<JudgeResultsViewerProps> = ({ result, testCase }) => {
  if (!testCase) return <div>Error: Test case not found</div>;

  return (
    <Paper sx={{ p: 2, mb: 2 }}>
      <Box sx={{ mb: 2}}>
        <Typography variant="h6" component="div">
          Test: #{result.testcase_id}
          <StatusButton status={result.result} />
        </Typography>
        <Typography color="text.secondary">
          実行時間: {result.timeMS}ms, メモリ: {result.memoryKB}KB
        </Typography>
      </Box>

      <Box sx={{ mb: 2 }}>
        <Typography>
          Exit code: {result.exit_code}
          {' / '}
          Expected exit code: {testCase.exit_code !== 0 ? 'panic(except for 0)' : testCase.exit_code}
        </Typography>
      </Box>

      {/* Exec command */}
      <Box sx={{ mb: 2 }}>
        <Typography variant="subtitle2" gutterBottom>実行コマンド:</Typography>
        <ScrollableTextField
          fullWidth
          multiline
          variant="outlined"
          value={result.command || '(No command)'}
          slotProps={{
            input: { readOnly: true },
          }}
        />
      </Box>

      <Divider sx={{ my: 2}}/>

      <Stack spacing={2}>
        {/* 標準入力 */}
        <Box>
          <Typography variant="subtitle2" gutterBottom>標準入力:</Typography>
          <ScrollableTextField
            fullWidth
            multiline={true}
            maxRows={10}
            variant="outlined"
            value={testCase.stdin || '(No input)'}
            slotProps={{
              input: { readOnly: true },
            }}
          />
        </Box>

        {/* 標準出力 */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Box flex={1}>
            <Typography variant="subtitle2" gutterBottom>標準出力:</Typography>
            <ScrollableTextField
              fullWidth
              multiline={true}
              maxRows={15}
              variant="outlined"
              value={result.stdout}
              slotProps={{
                input: { readOnly: true },
              }}
            />
          </Box>
          <Box flex={1}>
            <Typography variant="subtitle2" gutterBottom>標準出力(想定):</Typography>
            <ScrollableTextField
              fullWidth
              multiline={true}
              maxRows={15}
              variant="outlined"
              value={testCase.stdout || '(No expected output)'}
              slotProps={{
                input: { readOnly: true },
              }}
            />
          </Box>
        </Stack>

        {/* 標準エラー出力 */}
        <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2}>
          <Box flex={1}>
            <Typography variant="subtitle2" gutterBottom>標準エラー出力:</Typography>
            <ScrollableTextField
              fullWidth
              multiline={true}
              maxRows={15}
              variant="outlined"
              value={result.stderr}
              slotProps={{
                input: { readOnly: true },
              }}
            />
          </Box>
          <Box flex={1}>
            <Typography variant="subtitle2" gutterBottom>標準エラー出力(想定):</Typography>
            <ScrollableTextField
              fullWidth
              multiline={true}
              maxRows={15}
              variant="outlined"
              value={testCase.stderr || '(No expected stderr)'}
              slotProps={{
                input: { readOnly: true },
              }}
            />
          </Box>
        </Stack>
      </Stack>
    </Paper>
  )
};

export default JudgeResultsViewer;

