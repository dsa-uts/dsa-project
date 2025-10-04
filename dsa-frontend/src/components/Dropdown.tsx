import React, { useEffect, useState } from 'react';

const DEFAULT_OPTION = '問題を選択してください';
interface DropdownProps {
    subAssignmentsDropdown: { id: number; sub_id: number; title: string }[];
    onSelect: (id: number | null, subId: number | null) => void;
}

const Dropdown: React.FC<DropdownProps> = ({ subAssignmentsDropdown, onSelect }) => {
    const [selected, setSelected] = useState('');
    
    // ページ遷移した時に選択肢をリセット
    useEffect(() => {
        setSelected('');
    }, [subAssignmentsDropdown]);

    const handleChange = (event: React.ChangeEvent<HTMLSelectElement>) => {
        const value = event.target.value;
        setSelected(value);
        if (value !== "") {
        const [id, subId] = value.split('-').map(Number);
        onSelect(id, subId);
        } else {
            onSelect(null, null)
        }
    };

    return (
        <select value={selected} onChange={handleChange}>
        <option value="">{DEFAULT_OPTION}</option>
        {subAssignmentsDropdown.map((assignment) => (
            <option key={assignment.id} value={`${assignment.id}-${assignment.sub_id}`}>
            {assignment.title}
            </option>
        ))}
        </select>
    );
};

export default Dropdown;
