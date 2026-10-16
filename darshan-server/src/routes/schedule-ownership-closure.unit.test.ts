import { describe, expect, it } from 'vitest';
import { findScheduleOwnershipCompatibilityIssues } from '@/routes/schedule-publish-helper';

const owned = (
  id: string,
  scope: 'ORGANIZATION' | 'DEPARTMENT' | 'RESTRICTED',
  departmentId: string | null = null
) => ({
  id,
  created_by: 'creator',
  owner_scope: scope,
  owner_department_id: departmentId,
});

describe('schedule nested ownership closure', () => {
  it('accepts organization children and same-department or organization descendants', () => {
    const organizationSchedule = owned('schedule-org', 'ORGANIZATION');
    const organizationPresentation = {
      ...owned('presentation-org', 'ORGANIZATION'),
      layout: owned('layout-org', 'ORGANIZATION'),
      items: [{ id: 'item-org', media: owned('media-org', 'ORGANIZATION') }],
      slots: [],
    };
    expect(
      findScheduleOwnershipCompatibilityIssues(organizationSchedule, [organizationPresentation])
    ).toEqual([]);

    const departmentSchedule = owned('schedule-a', 'DEPARTMENT', 'department-a');
    const departmentPresentation = {
      ...owned('presentation-a', 'DEPARTMENT', 'department-a'),
      layout: owned('layout-org-2', 'ORGANIZATION'),
      items: [{ id: 'item-a', media: owned('media-a', 'DEPARTMENT', 'department-a') }],
      slots: [{ id: 'slot-org', media: owned('media-org-2', 'ORGANIZATION') }],
    };
    expect(
      findScheduleOwnershipCompatibilityIssues(departmentSchedule, [departmentPresentation])
    ).toEqual([]);
  });

  it('reports a narrower presentation and does not misclassify its descendants separately', () => {
    const issues = findScheduleOwnershipCompatibilityIssues(owned('schedule', 'ORGANIZATION'), [
      {
        ...owned('presentation-a', 'DEPARTMENT', 'department-a'),
        layout: owned('layout-a', 'DEPARTMENT', 'department-a'),
        items: [{ id: 'item-a', media: owned('media-a', 'DEPARTMENT', 'department-a') }],
      },
    ]);

    expect(issues).toEqual([
      {
        presentation_id: 'presentation-a',
        child_type: 'PRESENTATION',
        child_id: 'presentation-a',
      },
    ]);
  });

  it('reports legacy cross-scope layout and every incompatible media occurrence', () => {
    const presentation = {
      ...owned('presentation-org', 'ORGANIZATION'),
      layout: owned('layout-a', 'DEPARTMENT', 'department-a'),
      items: [{ id: 'item-a', media: owned('media-a', 'DEPARTMENT', 'department-a') }],
      slots: [{ id: 'slot-r', media: owned('media-r', 'RESTRICTED') }],
    };

    expect(
      findScheduleOwnershipCompatibilityIssues(owned('schedule-org', 'ORGANIZATION'), [presentation])
    ).toEqual([
      {
        presentation_id: 'presentation-org',
        child_type: 'LAYOUT',
        child_id: 'layout-a',
      },
      {
        presentation_id: 'presentation-org',
        child_type: 'MEDIA',
        child_id: 'media-a',
        occurrence_id: 'item-a',
      },
      {
        presentation_id: 'presentation-org',
        child_type: 'MEDIA',
        child_id: 'media-r',
        occurrence_id: 'slot-r',
      },
    ]);
  });
});
