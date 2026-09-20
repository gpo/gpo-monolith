import { createTheme, type MantineColorsTuple } from '@mantine/core';

// Matches the Green Party of Ontario logo green (#2f772f), which lands at shade 6.
const gpoGreen: MantineColorsTuple = [
  '#f0f9f0',
  '#dbf0db',
  '#b6e2b6',
  '#8ad08a',
  '#5fbf5f',
  '#40a040',
  '#2f772f',
  '#276227',
  '#205020',
  '#193e19',
];

export const theme = createTheme({
  primaryColor: 'gpoGreen',
  colors: {
    gpoGreen,
  },
});
