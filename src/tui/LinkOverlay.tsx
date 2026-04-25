import React from 'react';
import { Box, Text } from 'ink';

import type { PdfLink } from '../core/pdf-service.js';

type LinkOverlayProps = {
  links: PdfLink[];
  selectedIndex: number;
};

export function LinkOverlay({
  links,
  selectedIndex,
}: LinkOverlayProps): React.JSX.Element {
  return (
    <Box
      borderStyle="round"
      flexDirection="column"
      paddingX={1}
      paddingY={1}
      width={80}
    >
      <Text bold>Links</Text>
      {links.length === 0 ? (
        <Text dimColor>No links on this page</Text>
      ) : (
        links.map((link, index) => (
          <Text key={`${link.url}:${index}`}>
            {selectedIndex === index ? '> ' : '  '}
            {index + 1}. {link.text} -&gt; {link.url}
          </Text>
        ))
      )}
    </Box>
  );
}
