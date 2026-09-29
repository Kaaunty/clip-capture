'use client';

import React, { useState } from 'react';

export default function DeleteFieldButton({ fieldId, fieldName }: { fieldId: string; fieldName: string }) {
  const [loading, setLoading] = useState(false);

  const handleDelete = async () => {
    if (!confirm(`Tem certeza que deseja excluir o campo "${fieldName}"?`)) {
      return;
    }
    setLoading(true);
    try {
      const res = await fetch(`/api/v1/fields/${fieldId}`, {
        method: 'DELETE',
      });
      if (res.ok) {
        window.location.reload();
      } else {
        alert('Erro ao excluir campo');
      }
    } catch {
      alert('Erro de conexão');
    } finally {
      setLoading(false);
    }
  };

  return (
    <button
      onClick={handleDelete}
      disabled={loading}
      title="Excluir este campo"
      style={{
        background: 'none',
        border: '1px solid #fee2e2',
        color: '#dc2626',
        borderRadius: '6px',
        padding: '4px 8px',
        fontSize: '12px',
        fontWeight: '600',
        cursor: 'pointer',
      }}
    >
      {loading ? '...' : '🗑️ Excluir'}
    </button>
  );
}
