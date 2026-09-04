ALTER TABLE public.feedback_comments REPLICA IDENTITY FULL;
ALTER TABLE public.feedback_items REPLICA IDENTITY FULL;
ALTER TABLE public.activity_logs REPLICA IDENTITY FULL;
ALTER PUBLICATION supabase_realtime ADD TABLE public.feedback_comments;
ALTER PUBLICATION supabase_realtime ADD TABLE public.feedback_items;
ALTER PUBLICATION supabase_realtime ADD TABLE public.activity_logs;