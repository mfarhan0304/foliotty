import React from 'react';
import { Box, Text } from 'ink';
import TextInput from 'ink-text-input';

type SearchPromptProps = {
  label?: string;
  value: string;
  onChange: (value: string) => void;
  onSubmit?: (value: string) => void;
};

export function SearchPrompt({
  label = '/',
  value,
  onChange,
  onSubmit,
}: SearchPromptProps): React.JSX.Element {
  const inputProps =
    onSubmit === undefined
      ? { value, onChange }
      : { value, onChange, onSubmit };

  return (
    <Box borderStyle="single" paddingX={1}>
      <Text>{label}</Text>
      <TextInput {...inputProps} />
    </Box>
  );
}
