import React from 'react';
import { Box, Text } from 'ink';

export function HelpOverlay(): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      width={54}
    >
      <Text bold>Keys</Text>
      <Text>j / k previous or next line</Text>
      <Text>Ctrl-D / Ctrl-U scroll half page</Text>
      <Text>gg / G top or bottom</Text>
      <Text>J / K previous or next page</Text>
      <Text>p go to page</Text>
      <Text>t toggle preview or text mode</Text>
      <Text>l open links on current page</Text>
      <Text>Enter open selected link</Text>
      <Text>/ open search</Text>
      <Text>Enter submit search</Text>
      <Text>Esc cancel prompt, links, or help</Text>
      <Text>n / N next or previous hit</Text>
      <Text>? toggle help</Text>
      <Text>q quit</Text>
    </Box>
  );
}
