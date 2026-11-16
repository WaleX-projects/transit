import React from 'react';
import { Button, ButtonProps, useTheme } from 'react-native-paper';
import { radius, size, type } from '../tokens';

interface PrimaryButtonProps extends Omit<ButtonProps, 'children'> {
  children: string;
  variant?: 'primary' | 'orange' | 'outline';
}

export function PrimaryButton({
  children,
  variant = 'primary',
  disabled,
  style,
  ...rest
}: PrimaryButtonProps) {
  const { colors } = useTheme();

  const isOrange = variant === 'orange';
  const isOutline = variant === 'outline';

  const bgColor = isOutline
    ? 'transparent'
    : isOrange
      ? colors.secondary
      : colors.primary;

  const textColor = isOutline
    ? colors.primary
    : colors.onPrimary;

  return (
    <Button
      mode={isOutline ? 'outlined' : 'contained'}
      disabled={disabled}
      buttonColor={bgColor}
      textColor={textColor}
      contentStyle={{ height: size.touch }}
      style={[
        {
          borderRadius: radius.md,
          borderColor: isOutline ? colors.primary : undefined,
          borderWidth: isOutline ? 1 : 0,
        },
        style,
      ]}
      labelStyle={type.label}
      {...rest}
    >
      {children}
    </Button>
  );
}
