import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { chatApi } from '@/api/domains/chat';
import { Button } from '@/components/ui/button';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { useToast } from '@/hooks/use-toast';

export function DeletedChatContentDialog({ open, onOpenChange }: { open: boolean; onOpenChange: (open: boolean) => void }) {
  const { toast } = useToast();
  const queryClient = useQueryClient();
  const [conversationPage, setConversationPage] = useState(1);
  const [messagePage, setMessagePage] = useState(1);
  const conversations = useQuery({ queryKey: ['chat', 'deleted-conversations', conversationPage], queryFn: () => chatApi.deletedConversations(conversationPage), enabled: open });
  const messages = useQuery({ queryKey: ['chat', 'deleted-messages', messagePage], queryFn: () => chatApi.deletedMessages(messagePage), enabled: open });
  const restoreConversation = useMutation({
    mutationFn: chatApi.restoreConversation,
    onSuccess: () => { toast({ title: 'Conversation restored' }); void queryClient.invalidateQueries({ queryKey: ['chat'] }); },
    onError: (error: Error) => toast({ title: 'Restore failed', description: error.message, variant: 'destructive' }),
  });
  const restoreMessage = useMutation({
    mutationFn: chatApi.restoreMessage,
    onSuccess: () => { toast({ title: 'Message restored' }); void queryClient.invalidateQueries({ queryKey: ['chat'] }); },
    onError: (error: Error) => toast({ title: 'Restore failed', description: error.message, variant: 'destructive' }),
  });

  return <Dialog open={open} onOpenChange={onOpenChange}>
    <DialogContent className="max-h-[80vh] overflow-y-auto">
      <DialogHeader><DialogTitle>Deleted chat content</DialogTitle></DialogHeader>
      {(conversations.isError || messages.isError) && <p>Unable to load deleted chat content.</p>}
      <h3 className="font-semibold">Conversations</h3>
      {conversations.data?.items.length === 0 && <p>No deleted conversations.</p>}
      {conversations.data?.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 border-b py-2">
        <span>{item.title || item.type}</span>
        <Button variant="outline" disabled={restoreConversation.isPending} onClick={() => restoreConversation.mutate(item.id)}>Restore conversation</Button>
      </div>)}
      <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={conversationPage === 1 || conversations.isFetching} onClick={() => setConversationPage((page) => page - 1)}>Previous conversations</Button><span>Page {conversationPage}</span><Button variant="outline" disabled={conversations.isFetching || (conversations.data?.items.length ?? 0) < 100} onClick={() => setConversationPage((page) => page + 1)}>Next conversations</Button></div>
      <h3 className="font-semibold">Messages</h3>
      {messages.data?.items.length === 0 && <p>No deleted messages.</p>}
      {messages.data?.items.map((item) => <div key={item.id} className="flex items-center justify-between gap-2 border-b py-2">
        <span>Message {item.id.slice(0, 8)} in {item.conversation_id.slice(0, 8)}</span>
        <Button variant="outline" disabled={restoreMessage.isPending} onClick={() => restoreMessage.mutate(item.id)}>Restore message</Button>
      </div>)}
      <div className="flex items-center justify-between gap-2"><Button variant="outline" disabled={messagePage === 1 || messages.isFetching} onClick={() => setMessagePage((page) => page - 1)}>Previous messages</Button><span>Page {messagePage}</span><Button variant="outline" disabled={messages.isFetching || (messages.data?.items.length ?? 0) < 100} onClick={() => setMessagePage((page) => page + 1)}>Next messages</Button></div>
    </DialogContent>
  </Dialog>;
}
