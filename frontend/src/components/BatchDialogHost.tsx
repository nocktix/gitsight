import { useBatch } from "../context/useBatch";
import BatchPanel from "./BatchPanel";
import { Dialog } from "./RubricDialogs";

/** La ventana del lote vive aquí para abrirse desde el botón de la tarea o desde "Ver lote". */
export default function BatchDialogHost() {
  const { dialogOpen, closeDialog } = useBatch();
  return dialogOpen ? (
    <Dialog onClose={closeDialog} title="Tarea completa (carpeta)" wide>
      <BatchPanel />
    </Dialog>
  ) : null;
}
