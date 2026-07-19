import React from 'react';

export const Button = ({
  children,
  variant: _variant,
  size: _size,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { variant?: string; size?: string }) => (
  <button {...props}>{children}</button>
);

export default Button;
