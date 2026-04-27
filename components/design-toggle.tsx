"use client"

import { useState, useEffect } from "react"
import { Button } from "@/components/ui/button"
import { Palette, RotateCcw } from "lucide-react"
import { showInfo } from "@/lib/toast"

export function DesignToggle() {
  const [isModern, setIsModern] = useState(true)

  useEffect(() => {
    // Check localStorage for saved preference
    const saved = localStorage.getItem('design-mode')
    if (saved === 'classic') {
      setIsModern(false)
      document.documentElement.setAttribute('data-design', 'classic')
    } else {
      setIsModern(true)
      document.documentElement.setAttribute('data-design', 'modern')
    }
  }, [])

  const toggleDesign = () => {
    const newMode = !isModern
    setIsModern(newMode)
    
    // Apply design mode to document
    document.documentElement.setAttribute('data-design', newMode ? 'modern' : 'classic')
    
    // Save preference
    localStorage.setItem('design-mode', newMode ? 'modern' : 'classic')
    
    // Show feedback
    showInfo(newMode ? 'Modern design enabled' : 'Classic design restored')
  }

  return (
    <Button
      variant="ghost"
      size="sm"
      onClick={toggleDesign}
      className="hidden lg:flex fixed bottom-4 right-4 z-50 shadow-lg hover:shadow-xl transition-all"
      title={isModern ? "Switch to classic design" : "Switch to modern design"}
    >
      {isModern ? (
        <>
          <RotateCcw className="h-4 w-4 mr-2" />
          Classic
        </>
      ) : (
        <>
          <Palette className="h-4 w-4 mr-2" />
          Modern
        </>
      )}
    </Button>
  )
}

