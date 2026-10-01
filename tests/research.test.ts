import { describe, expect, it } from 'vitest'
import { describeAction, planBatch, type AgentAction } from '../src/shared/agent'
import { checkLimits, NO_LIMITS } from '../src/shared/limits'
import { actionSignature } from '../src/shared/loop'
import { needsApproval, riskOf } from '../src/shared/safety'
import { recordable } from '../src/shared/workflow'

const search: AgentAction = { type: 'research', query: 'top 10 Indian companies by revenue FY2024-25' }
const typeTable: AgentAction = { type: 'type', text: 'Company\tRevenue\nTCS\t1' }
const clickCell: AgentAction = { type: 'click', x: 100, y: 200, button: 'left', double: false, purpose: 'Click A1' }

describe('web_search runs alone, before anything uses it', () => {
  it('drops everything else planned in the same turn', () => {
    const plan = planBatch([clickCell, search, typeTable])
    expect(plan.actions).toEqual([search])
    expect(plan.presets[0]).toMatch(/web_search runs alone/)
    expect(plan.presets[1]).toBeUndefined()
    expect(plan.presets[2]).toMatch(/web_search runs alone/)
  })

  it('a lone search is simply run', () => {
    expect(planBatch([search]).actions).toEqual([search])
  })
})

describe('a search is thinking, not acting', () => {
  it('needs no approval - it changes nothing on the machine', () => {
    expect(riskOf(search)).toBeNull()
    expect(needsApproval(search, 'sensitive').ask).toBe(false)
  })

  it('is not fenced by app or site limits - it touches no window', () => {
    const limits = { ...NO_LIMITS, apps: ['notepad'], sites: ['example.com'] }
    expect(checkLimits(search, limits, { windowTitle: 'Google Chrome' })).toBeNull()
  })

  it('is left out of a saved workflow, so a replay never searches', () => {
    expect(recordable([search, clickCell, typeTable])).toEqual([clickCell, typeTable])
  })

  it('is described and loop-checked like any other step', () => {
    expect(describeAction(search)).toMatch(/^Search the web: "top 10 Indian/)
    expect(actionSignature(search)).toBe(actionSignature({ ...search, query: search.query.toUpperCase() }))
  })
})
