import React from 'react';
import { View } from 'react-native';
import { HelperText, TextInput, TextInputProps } from 'react-native-paper';
import { radius, space } from '../tokens';

type Props = Omit<TextInputProps, 'error'> & {
  error?: string;
};

export function FormField({ error, ...rest }: Props) {
  return (
    <View style={{ gap: space.xs }}>
      <TextInput
        mode="outlined"
        error={!!error}
        outlineStyle={{ borderRadius: radius.md }}
        {...rest}
      />
      {!!error && (
        <HelperText type="error" visible style={{ paddingHorizontal: 0 }}>
          {error}
        </HelperText>
      )}
    </View>
  );
}
