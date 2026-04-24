import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

type SearchPromptProps = {
  value: string;
  onChange: (value: string) => void;
};

export function SearchPrompt({
  value,
  onChange,
}: SearchPromptProps): React.JSX.Element {
  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>/</Text>
      <TextInput value={value} onChange={onChange} />
    </Box>
  );
}
