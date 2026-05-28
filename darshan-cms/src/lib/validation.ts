const EMAIL_REGEX = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

export const isValidEmail = (value: string) => EMAIL_REGEX.test(value.trim());

export const isNonEmpty = (value: string, min = 1) => value.trim().length >= min;

export const isSecurePassword = (value: string, min = 8) => value.length >= min;
