import React from 'react';
import AsyncSelect from 'react-select/async';

export const UserAsyncSelect = ({ value, onChange, placeholder = "Search user by name or email..." }) => {
  // Fetches users from Go backend on user typing
  const loadOptions = async (inputValue) => {
    try {
      const res = await fetch(`/api/users?search=${encodeURIComponent(inputValue)}`);
      if (!res.ok) return [];
      const data = await res.json();
      
      return (data.users || []).map(user => ({
        value: user.id || user.ID,
        label: `${user.name} (${user.email}) - ${user.role}`,
        user: user
      }));
    } catch (err) {
      console.error('Failed to load user options:', err);
      return [];
    }
  };

  return (
    <AsyncSelect
      cacheOptions
      defaultOptions
      isSearchable
      loadOptions={loadOptions}
      onChange={(selectedOption) => onChange(selectedOption ? selectedOption.value : '')}
      value={value ? { value, label: `Selected User #${value}` } : null}
      placeholder={placeholder}
      className="text-xs my-1"
      classNamePrefix="react-select"
    />
  );
};