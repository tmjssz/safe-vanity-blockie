'use client'

import { useState } from 'react'
import { ConfigForm } from '../components/ConfigForm'
import { SecurityNotice } from '../components/SecurityNotice'
import type { MineConfig } from '../lib/config'

export default function Page() {
  const [config, setConfig] = useState<MineConfig | undefined>()

  return (
    <>
      <SecurityNotice />
      {config ? (
        <pre>{JSON.stringify(config, null, 2)}</pre>
      ) : (
        <ConfigForm onSubmit={setConfig} />
      )}
    </>
  )
}
