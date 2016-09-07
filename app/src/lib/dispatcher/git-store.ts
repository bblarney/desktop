import { Emitter, Disposable } from 'event-kit'
import Repository from '../../models/repository'
import { LocalGitOperations, Commit } from '../local-git-operations'

/** The number of commits to load from history per batch. */
const CommitBatchSize = 100

/** The store for a repository's git data. */
export default class GitStore {
  private readonly emitter = new Emitter()

  /** The commits keyed by their SHA. */
  public readonly commits = new Map<string, Commit>()

  private _history: ReadonlyArray<string> = new Array()

  private readonly requestsInFight = new Set<string>()

  private readonly repository: Repository

  public constructor(repository: Repository) {
    this.repository = repository
  }

  private emitUpdate() {
    this.emitter.emit('did-update', {})
  }

  private emitNewCommitsLoaded(commits: ReadonlyArray<Commit>) {
    this.emitter.emit('did-load-new-commits', commits)
  }

  /** Register a function to be called when the store updates. */
  public onDidUpdate(fn: () => void): Disposable {
    return this.emitter.on('did-update', fn)
  }

  /** Register a function to be called when the store loads new commits. */
  public onDidLoadNewCommits(fn: (commits: ReadonlyArray<Commit>) => void): Disposable {
    return this.emitter.on('did-load-new-commits', fn)
  }

  public async loadHistory() {
    let commits = await LocalGitOperations.getHistory(this.repository, 'HEAD', CommitBatchSize)

    const existingHistory = this._history
    if (existingHistory.length > 0) {
      const mostRecent = existingHistory[0]
      const index = commits.findIndex(c => c.sha === mostRecent)
      if (index > -1) {
        commits = commits.slice(0, index)
      }
    }

    this._history = this._history.concat(commits.map(c => c.sha))
    for (const commit of commits) {
      this.commits.set(commit.sha, commit)
    }

    this.emitNewCommitsLoaded(commits)
    this.emitUpdate()
  }

  public async loadNextHistoryBatch() {
    const lastSHA = this.history[this.history.length - 1]
    const commits = await LocalGitOperations.getHistory(this.repository, `${lastSHA}^`, CommitBatchSize)

    this._history = this._history.concat(commits.map(c => c.sha))
    for (const commit of commits) {
      this.commits.set(commit.sha, commit)
    }

    this.emitNewCommitsLoaded(commits)
    this.emitUpdate()
  }

  public async loadCommit(sha: string) {
    const existingCommit = this.commits.get(sha)
    // We've already loaded this commit and commits are I M M U T A B L E
    if (existingCommit) { return }

    const requestKey = `commit/${sha}`
    // We're already loading this commit so chill.
    if (this.requestsInFight.has(requestKey)) { return }

    this.requestsInFight.add(requestKey)

    const commit = await LocalGitOperations.getCommit(this.repository, sha)
    if (!commit) { return }

    this.commits.set(commit.sha, commit)

    this.requestsInFight.delete(requestKey)

    this.emitNewCommitsLoaded([ commit ])
    this.emitUpdate()
  }

  /** The list of ordered SHAs. */
  public get history(): ReadonlyArray<string> {
    return this._history
  }
}
