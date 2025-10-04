import React from 'react';
import { Prism as SyntaxHighlighter } from 'react-syntax-highlighter';
import { oneLight } from 'react-syntax-highlighter/dist/esm/styles/prism';

interface CodeBlockProps {
  code: string;
  fileName: string;
}

const CodeBlock: React.FC<CodeBlockProps> = ({ code, fileName }) => {
  const getLanguage = (fileName: string): string => {
    if (fileName.endsWith('.c')) {
      return 'c';
    } else if (fileName.endsWith('.h')) {
      return 'c';
    } else if (fileName === 'Makefile') {
      return 'makefile';
    } else if (fileName.endsWith('.py')) {
      return 'python';
    }
    return 'text';
  };

  const language = getLanguage(fileName);

  return (
    <SyntaxHighlighter language={language} style={oneLight}>
      {code}
    </SyntaxHighlighter>
  );
};

export default CodeBlock;
