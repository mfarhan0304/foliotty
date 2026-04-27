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

      <Text bold> </Text>
      <Text bold>Read</Text>
      <Text> j / k previous or next line</Text>
      <Text> J / K previous or next page</Text>
      <Text> p go to page</Text>
      <Text> t toggle preview or text mode</Text>

      <Text bold> </Text>
      <Text bold>Search</Text>
      <Text> / search</Text>
      <Text> Enter submit search</Text>
      <Text> n / N next or previous search</Text>

      <Text bold> </Text>
      <Text bold>Links</Text>
      <Text> l show links on current page</Text>
      <Text> Enter open selected link</Text>

      <Text bold> </Text>
      <Text bold>App</Text>
      <Text> ? toggle help</Text>
      <Text> Esc cancel or quit</Text>
    </Box>
  );
}
