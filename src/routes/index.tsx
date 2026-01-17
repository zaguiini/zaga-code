import { createFileRoute } from '@tanstack/react-router'
import { useCallback, useState } from 'react'
import Chat from '../components/Chat'
import ProjectPathInput from '../components/ProjectPathInput'
import '../App.css'

export const Route = createFileRoute('/')({ component: App })

function App() {
  const [projectPath, setProjectPath] = useState<string>('')

  const handleProjectPathChange = useCallback((path: string) => {
    setProjectPath(path)
  }, [])

  return (
    <div className="App">
      <div className="app-container">
        <h1>Agent Chat Interface</h1>
        <ProjectPathInput value={projectPath} onChange={handleProjectPathChange} />
        {projectPath && <Chat projectPath={projectPath} />}
      </div>
    </div>
  )
}
