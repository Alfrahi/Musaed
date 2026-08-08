# Info Feature

## Purpose

Displays application information modal — version, build details, and external links. A minimal, standalone UI-only feature with no state or persistence.

## Public API (`index.ts`)

### Components

| Export      | Source                     | Description                                      |
| ----------- | -------------------------- | ------------------------------------------------ |
| `InfoModal` | `components/InfoModal.tsx` | Modal dialog showing app info and external links |

### Feature Manifest

| Export        | Source                | Description                                 |
| ------------- | --------------------- | ------------------------------------------- |
| `InfoFeature` | `feature.manifest.ts` | Feature manifest (no state, no persistence) |

## IPC Endpoints

| Command               | Purpose                                    |
| --------------------- | ------------------------------------------ |
| `cmd_opener_open_url` | Open an external URL in the system browser |

## State Schemas

None — this is a stateless UI-only feature.

## Dependencies

None — fully standalone.

## Example Usage

```tsx
import { InfoModal } from '@/features/info';

function App() {
  const [showInfo, setShowInfo] = useState(false);
  return (
    <>
      <button onClick={() => setShowInfo(true)}>About</button>
      {showInfo && <InfoModal onClose={() => setShowInfo(false)} />}
    </>
  );
}
```

## Related Docs

- [Migration Framework](../../../../../docs/migration-framework.md)
