-- Alt texts (D89): only a failure waits a day now. Pictures the AI described
-- in full may be written again at once, as when the site gains a language.
UPDATE commerce.media SET alt_tried_at = NULL WHERE alt_source = 'ai';
