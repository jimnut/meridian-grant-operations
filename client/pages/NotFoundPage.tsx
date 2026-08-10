import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { Compass } from 'lucide-react';

import { BRAND } from '../../shared/brand';
import { EmptyState } from '../components/ui';

export function NotFoundPage() {
  useEffect(() => {
    document.title = `Page not found · ${BRAND.titleSuffix}`;
  }, []);

  return (
    <div className="card">
      <EmptyState
        icon={<Compass size={20} />}
        title="That page does not exist"
        description="The link may be out of date, or the record may belong to another organization."
        action={
          <Link to="/" className="btn btn--primary">
            Back to Today
          </Link>
        }
      />
    </div>
  );
}
