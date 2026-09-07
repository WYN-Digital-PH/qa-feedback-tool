-- =========================================================================
-- Repair: the mention trigger was missing
-- =========================================================================
--
-- `20260908130000` created `render_mentions()` and `notify_comment_mentions()`
-- and then attached the trigger. The two functions are demonstrably live on the
-- remote database -- `render_mentions` resolves a real token, using the tight
-- uuid pattern that only the final version of that file carried -- but posting
-- an internal note that named a teammate produced no notification, with the
-- author, the mention and the mentioned member's role all verified correct.
-- Whatever the cause, the trigger was not attached.
--
-- Re-attaching is idempotent: `DROP TRIGGER IF EXISTS` then `CREATE TRIGGER`
-- leaves exactly one trigger whether or not one was already there.

DROP TRIGGER IF EXISTS feedback_comments_notify_mentions ON public.feedback_comments;

CREATE TRIGGER feedback_comments_notify_mentions
  AFTER INSERT OR UPDATE OF body ON public.feedback_comments
  FOR EACH ROW EXECUTE FUNCTION public.notify_comment_mentions();
