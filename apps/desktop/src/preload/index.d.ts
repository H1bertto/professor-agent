import type { ProfessorApi } from '../shared/api'

declare global {
  interface Window {
    professor: ProfessorApi
  }
}
