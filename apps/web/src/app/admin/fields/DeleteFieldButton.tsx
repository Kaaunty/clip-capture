'use client';

import React, { useState } from 'react';
import { Button } from '../../../components/ui';

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
    <Button
      variant="dangerOutline"
      size="xs"
      onClick={handleDelete}
      disabled={loading}
      title="Excluir este campo"
    >
      {loading ? '...' : '🗑️ Excluir'}
    </Button>
  );
}
