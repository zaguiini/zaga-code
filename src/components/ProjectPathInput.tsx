import { useEffect, useRef, useState } from 'react'
import './ProjectPathInput.css'

interface ProjectPathInputProps {
  value?: string
  onChange: (path: string) => void
  onValidationChange?: (isValid: boolean) => void
}

const STORAGE_KEY = 'agent-project-path'

export default function ProjectPathInput({
  value = '',
  onChange,
  onValidationChange,
}: ProjectPathInputProps) {
  const [inputValue, setInputValue] = useState(value)
  const [isValid, setIsValid] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const onChangeRef = useRef(onChange)
  const hasLoadedRef = useRef(false)

  // Keep ref updated
  useEffect(() => {
    onChangeRef.current = onChange
  }, [onChange])

  // Load from localStorage on mount (only once)
  useEffect(() => {
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true

    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved) {
      setInputValue(saved)
      onChangeRef.current(saved)
    }
  }, [])

  // Sync with external value changes
  useEffect(() => {
    if (value !== inputValue) {
      setInputValue(value)
    }
  }, [value])

  const validatePath = (path: string): boolean => {
    if (!path.trim()) {
      // Empty path is valid (will use current directory)
      setError(null)
      return true
    }

    // Basic validation: check if it looks like a valid path
    if (!path.startsWith('/')) {
      setError('Please use a absolute path')
      return false
    }
    setError(null)
    return true
  }

  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const newValue = e.target.value
    setInputValue(newValue)

    const valid = validatePath(newValue)
    setIsValid(valid)
    onValidationChange?.(valid)

    if (valid) {
      onChange(newValue)
      // Save to localStorage
      if (newValue.trim()) {
        localStorage.setItem(STORAGE_KEY, newValue)
      } else {
        localStorage.removeItem(STORAGE_KEY)
      }
    }
  }

  const handleUseCurrentDir = () => {
    setInputValue('')
    setIsValid(true)
    setError(null)
    onChange('')
    localStorage.removeItem(STORAGE_KEY)
    onValidationChange?.(true)
  }

  return (
    <div className="project-path-input">
      <label htmlFor="project-path" className="project-path-label">
        Project Path
      </label>
      <div className="project-path-controls">
        <input
          id="project-path"
          type="text"
          className={`project-path-field ${!isValid ? 'invalid' : ''}`}
          value={inputValue}
          onChange={handleChange}
          placeholder="Leave empty to use current directory"
        />
        <button
          type="button"
          className="project-path-button"
          onClick={handleUseCurrentDir}
          title="Use current directory"
        >
          Use Current Dir
        </button>
      </div>
      {error && <div className="project-path-error">{error}</div>}
      {!error && inputValue && (
        <div className="project-path-hint">Path: {inputValue || '(current directory)'}</div>
      )}
    </div>
  )
}
