'use client';

import ActiveRunBanner from '@/components/ActiveRunBanner';
import AttackForm from '@/components/AttackForm';
import AttackResult from '@/components/AttackResult';
import AttackHistory from '@/components/AttackHistory';

export default function AttackConsole() {
  return (
    <div>
      <ActiveRunBanner />
      <AttackForm />
      <AttackResult />
      <AttackHistory />
    </div>
  );
}
