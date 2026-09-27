import { useState } from 'react';
import RepositoryLayout from '../components/RepositoryLayout';
import { formatUpdatedAt } from '../repository';
import { useIssueDetail } from '../issues';
import {
  apiUpdateIssue,
  apiUpdateIssueLabels,
  apiUpdateIssueMilestone,
  apiUpdateIssueStatus,
  isApiError,
} from '../api';
import type { IssueActivity, RepoMilestone } from '../api';

function activityText(activity: IssueActivity, issueNumber: number): string {
  switch (activity.type) {
    case 'created':
      return `${activity.author} created this issue`;
    case 'comment':
      return `${activity.author} commented`;
    case 'label_added':
      return `${activity.author} added the ${activity.label} label`;
    case 'label_removed':
      return `${activity.author} removed the ${activity.label} label`;
    case 'status_changed':
      return `${activity.author} changed the status`;
    case 'title_edited':
      return `${activity.author} edited the title`;
    case 'description_edited':
      return `${activity.author} edited the description`;
    case 'milestone_changed':
      return activity.milestone
        ? `${activity.author} set the milestone to ${activity.milestone}`
        : `${activity.author} removed the milestone`;
    case 'closed':
      return `${activity.author} closed issue #${issueNumber}`;
    case 'reopened':
      return `${activity.author} reopened issue #${issueNumber}`;
    default:
      return `${activity.author} ${activity.type}`;
  }
}

function LabelPicker({
  owner,
  name,
  number,
  applied,
  available,
  onChanged,
}: {
  owner: string;
  name: string;
  number: number;
  applied: string[];
  available: { name: string; color: string }[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function toggleLabel(labelName: string) {
    const next = applied.includes(labelName)
      ? applied.filter((l) => l !== labelName)
      : [...applied, labelName];
    setSaving(true);
    setError(null);
    try {
      await apiUpdateIssueLabels(owner, name, number, next);
      setOpen(false);
      onChanged();
    } catch (err) {
      if (isApiError(err) && (err.status === 403 || err.status === 404)) {
        setError('You are not allowed to change labels.');
      } else {
        setError('Labels could not be updated. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="meta-actions">
      <button
        type="button"
        className="meta-button"
        aria-label="Labels"
        aria-expanded={open}
        disabled={saving}
        onClick={() => setOpen((o) => !o)}
      >
        Labels
      </button>
      {open && (
        <div role="listbox" aria-label="Labels" className="filter-popover">
          {available.map((label) => (
            <div
              key={label.name}
              role="option"
              aria-selected={applied.includes(label.name)}
              onClick={() => toggleLabel(label.name)}
            >
              {label.name}
            </div>
          ))}
        </div>
      )}
      {error && <p role="alert" className="form-error">{error}</p>}
    </div>
  );
}

function MilestonePicker({
  owner,
  name,
  number,
  current,
  available,
  onChanged,
}: {
  owner: string;
  name: string;
  number: number;
  current: string | null;
  available: RepoMilestone[];
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function select(milestone: string | null) {
    setSaving(true);
    setError(null);
    try {
      await apiUpdateIssueMilestone(owner, name, number, milestone);
      setOpen(false);
      onChanged();
    } catch (err) {
      if (isApiError(err) && (err.status === 403 || err.status === 404)) {
        setError('You are not allowed to change the milestone.');
      } else {
        setError('The milestone could not be updated. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="meta-actions">
      <button
        type="button"
        className="meta-button"
        aria-label="Milestone"
        aria-expanded={open}
        disabled={saving}
        onClick={() => setOpen((o) => !o)}
      >
        ⚙
      </button>
      {open && (
        <div role="listbox" aria-label="Milestone" className="filter-popover">
          {available.map((milestone) => (
            <div
              key={milestone.name}
              role="option"
              aria-selected={current === milestone.name}
              onClick={() => select(milestone.name)}
            >
              {milestone.name}
            </div>
          ))}
          <div
            role="option"
            aria-selected={current === null}
            onClick={() => select(null)}
          >
            None
          </div>
        </div>
      )}
      {error && <p role="alert" className="form-error">{error}</p>}
    </div>
  );
}

function TitleEditor({
  owner,
  name,
  number,
  current,
  onChanged,
}: {
  owner: string;
  name: string;
  number: number;
  current: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openForm() {
    setValue(current);
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiUpdateIssue(owner, name, number, { title: value });
      setOpen(false);
      onChanged();
    } catch (err) {
      if (isApiError(err) && err.body.fieldErrors?.title) {
        setError(err.body.fieldErrors.title);
      } else if (isApiError(err) && (err.status === 403 || err.status === 404)) {
        setError('You are not allowed to edit the issue title.');
      } else {
        setError('The issue title could not be saved. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="issue-editor">
      <button
        type="button"
        className="secondary-button"
        aria-expanded={open}
        onClick={openForm}
      >
        Edit issue title
      </button>
      {open && (
        <form className="issue-edit-form" onSubmit={handleSubmit}>
          <label htmlFor={`issue-title-${number}`}>Issue title</label>
          <input
            id={`issue-title-${number}`}
            type="text"
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" className="primary-button" disabled={saving}>
            Save issue title
          </button>
          {error && <p role="alert" className="form-error">{error}</p>}
        </form>
      )}
    </div>
  );
}

function DescriptionEditor({
  owner,
  name,
  number,
  current,
  onChanged,
}: {
  owner: string;
  name: string;
  number: number;
  current: string;
  onChanged: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState(current);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function openForm() {
    setValue(current);
    setError(null);
    setOpen(true);
  }

  async function handleSubmit(event: React.FormEvent) {
    event.preventDefault();
    setSaving(true);
    setError(null);
    try {
      await apiUpdateIssue(owner, name, number, { description: value });
      setOpen(false);
      onChanged();
    } catch (err) {
      if (isApiError(err) && err.body.fieldErrors?.description) {
        setError(err.body.fieldErrors.description);
      } else if (isApiError(err) && (err.status === 403 || err.status === 404)) {
        setError('You are not allowed to edit the issue description.');
      } else {
        setError('The issue description could not be saved. Please try again.');
      }
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="issue-editor">
      <button
        type="button"
        className="secondary-button"
        aria-expanded={open}
        onClick={openForm}
      >
        Edit issue description
      </button>
      {open && (
        <form className="issue-edit-form" onSubmit={handleSubmit}>
          <label htmlFor={`issue-description-${number}`}>Issue description</label>
          <textarea
            id={`issue-description-${number}`}
            rows={6}
            value={value}
            onChange={(event) => setValue(event.target.value)}
          />
          <button type="submit" className="primary-button" disabled={saving}>
            Save issue description
          </button>
          {error && <p role="alert" className="form-error">{error}</p>}
        </form>
      )}
    </div>
  );
}

export default function IssueDetailPage({
  owner,
  name,
  number,
}: {
  owner: string;
  name: string;
  number: string;
}) {
  const numericNumber = Number(number);
  const { state, reload } = useIssueDetail(owner, name, numericNumber);
  const [statusSaving, setStatusSaving] = useState(false);
  const [statusError, setStatusError] = useState<string | null>(null);

  if (state.status === 'loading') {
    return (
      <main className="repo-page">
        <p>Loading…</p>
      </main>
    );
  }

  if (state.status === 'notFound') {
    return (
      <main className="repo-page">
        <h1>Issue not found</h1>
        <p className="muted">The issue does not exist or you do not have access to it.</p>
      </main>
    );
  }

  if (state.status === 'error') {
    return (
      <main className="repo-page">
        <div role="alert">
          <p className="form-error">Issue could not be loaded. Please try again.</p>
          <button type="button" className="secondary-button" onClick={reload}>
            Retry
          </button>
        </div>
      </main>
    );
  }

  const { repository, issue, labels, milestones } = state;
  const isOpen = issue.status === 'open';
  const canEditContent = issue.permissions.canEditContent;
  const canManageMetadata = issue.permissions.manageMetadata;

  async function toggleStatus() {
    setStatusSaving(true);
    setStatusError(null);
    try {
      await apiUpdateIssueStatus(owner, name, numericNumber, isOpen ? 'closed' : 'open');
      reload();
    } catch (err) {
      if (isApiError(err) && (err.status === 403 || err.status === 404)) {
        setStatusError('You are not allowed to change the issue status.');
      } else {
        setStatusError('The issue status could not be updated. Please try again.');
      }
    } finally {
      setStatusSaving(false);
    }
  }

  return (
    <RepositoryLayout repository={repository} activeTab="issues">
      <div className="issue-detail">
        <header className="issue-detail-header">
          <h1>{issue.title}</h1>
          <span className="issue-number">#{issue.number}</span>
          <span className={`issue-status ${isOpen ? 'status-open' : 'status-closed'}`}>
            {isOpen ? 'Open' : 'Closed'}
          </span>
          {canManageMetadata && (
            <button
              type="button"
              className="secondary-button issue-status-button"
              disabled={statusSaving}
              onClick={toggleStatus}
            >
              {isOpen ? 'Close issue' : 'Reopen issue'}
            </button>
          )}
        </header>
        {statusError && <p role="alert" className="form-error">{statusError}</p>}

        {canEditContent && (
          <TitleEditor
            owner={owner}
            name={name}
            number={numericNumber}
            current={issue.title}
            onChanged={reload}
          />
        )}

        <div className="issue-detail-grid">
          <div className="issue-detail-main">
            {canEditContent && (
              <DescriptionEditor
                owner={owner}
                name={name}
                number={numericNumber}
                current={issue.description || ''}
                onChanged={reload}
              />
            )}

            {issue.description ? (
              <div className="issue-description">{issue.description}</div>
            ) : (
              <p className="muted">No description provided.</p>
            )}

            <section className="issue-discussion" aria-labelledby="comments-heading">
              <h2 id="comments-heading">Comments</h2>
              {issue.comments.length === 0 ? (
                <p className="muted">No comments</p>
              ) : (
                issue.comments.map((comment) => (
                  <article key={comment.id} className="comment">
                    <header className="comment-header">
                      <strong>{comment.author}</strong>
                      <span className="muted">commented {formatUpdatedAt(comment.createdAt)}</span>
                    </header>
                    <div className="comment-body">{comment.body}</div>
                  </article>
                ))
              )}
            </section>

            <section className="issue-timeline" aria-labelledby="activity-heading">
              <h2 id="activity-heading">Activity</h2>
              <ol className="activity-list">
                {issue.activity.map((activity) => (
                  <li key={activity.id} className="activity-item">
                    <span>{activityText(activity, issue.number)}</span>
                    <span className="muted">{formatUpdatedAt(activity.createdAt)}</span>
                  </li>
                ))}
              </ol>
            </section>
          </div>

          <aside className="issue-sidebar">
            <div className="meta-block">
              <h3>Assignees</h3>
              {issue.assignees.length === 0 ? (
                <p className="muted">No one</p>
              ) : (
                <ul className="meta-list">
                  {issue.assignees.map((assignee) => (
                    <li key={assignee}>{assignee}</li>
                  ))}
                </ul>
              )}
            </div>
            <div className="meta-block">
              <h3>Labels</h3>
              {issue.labels.length === 0 ? (
                <p className="muted">None yet</p>
              ) : (
                <ul className="label-list">
                  {issue.labels.map((label) => (
                    <li key={label}>
                      <span className="label-badge">{label}</span>
                    </li>
                  ))}
                </ul>
              )}
              {canManageMetadata && (
                <LabelPicker
                  owner={owner}
                  name={name}
                  number={numericNumber}
                  applied={issue.labels}
                  available={labels}
                  onChanged={reload}
                />
              )}
            </div>
            <div className="meta-block">
              <h3>Milestone</h3>
              {issue.milestone ? (
                <p className="meta-value">{issue.milestone}</p>
              ) : (
                <p className="muted">No milestone</p>
              )}
              {canManageMetadata && (
                <MilestonePicker
                  owner={owner}
                  name={name}
                  number={numericNumber}
                  current={issue.milestone}
                  available={milestones}
                  onChanged={reload}
                />
              )}
            </div>
          </aside>
        </div>
      </div>
    </RepositoryLayout>
  );
}
