// utils/formHelpers.ts
import {
  UseFormReturn,
  FieldValues,
  Path,
  DefaultValues,
  get,
} from "react-hook-form";

export const setFormValues = <T extends FieldValues>(
  form: UseFormReturn<T>,
  values: Partial<T>,
  options?: {
    shouldValidate?: boolean;
    shouldDirty?: boolean;
    shouldTouch?: boolean;
  }
) => {
  const defaultOptions = {
    shouldValidate: true,
    shouldDirty: true,
    shouldTouch: false,
    ...options,
  };

  (Object.entries(values) as Array<[keyof T, T[keyof T]]>).forEach(
    ([key, value]) => {
      if (value !== undefined) {
        form.setValue(key as Path<T>, value, defaultOptions);
      }
    }
  );
};

export const resetFormWithValues = <T extends FieldValues>(
  form: UseFormReturn<T>,
  values: Partial<T>
) => {
  form.reset(values as DefaultValues<T>);
};

export const clearFormFields = <T extends FieldValues>(
  form: UseFormReturn<T>,
  fields: Array<Path<T>>,
  clearValue: string | number | boolean | null = ""
) => {
  fields.forEach((field) => {
    form.setValue(field, clearValue as T[Path<T>]);
  });
};

// Thêm helper để clear toàn bộ form về default values
export const clearAllFields = <T extends FieldValues>(
  form: UseFormReturn<T>
) => {
  form.reset();
};

// Helper để set một field cụ thể với type safety
export const setFormValue = <T extends FieldValues, K extends Path<T>>(
  form: UseFormReturn<T>,
  field: K,
  value: T[K],
  options?: {
    shouldValidate?: boolean;
    shouldDirty?: boolean;
    shouldTouch?: boolean;
  }
) => {
  const defaultOptions = {
    shouldValidate: true,
    shouldDirty: true,
    shouldTouch: false,
    ...options,
  };

  form.setValue(field, value, defaultOptions);
};

// Helper để get multiple values
export const getFormValues = <T extends FieldValues>(
  form: UseFormReturn<T>,
  fields: Array<Path<T>>
): Partial<T> => {
  const values: Partial<T> = {};

  fields.forEach((field) => {
    values[field as keyof T] = form.getValues(field);
  });

  return values;
};

// Helper để check dirty fields
export const isDirtyFields = <T extends FieldValues>(
  form: UseFormReturn<T>,
  fields: Array<Path<T>>
): boolean => {
  return fields.some((field) => get(form.formState.dirtyFields, field));
};

// Helper để validate specific fields
export const validateFields = async <T extends FieldValues>(
  form: UseFormReturn<T>,
  fields: Array<Path<T>>
): Promise<boolean> => {
  const results = await Promise.all(fields.map((field) => form.trigger(field)));

  return results.every((result) => result);
};
